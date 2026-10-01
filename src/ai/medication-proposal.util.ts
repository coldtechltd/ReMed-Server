import { BadRequestException } from '@nestjs/common';
import type { CreateFullMedicationDto } from '../medication/dto/create-full-medication.dto';
import {
  assertValidScheduleTypeFields,
  zonedTimeToUtc,
} from '../schedule/schedule.util';

/**
 * Remmy's medication proposals: checking what the model proposed, and turning
 * a confirmed proposal into the same `createFull` request the wizard sends.
 * Pure, so the rules are testable without a database or the model — same split
 * as stock.util.ts.
 *
 * A proposal used to be one drug with one schedule and no end date. Asked for
 * "Flu treatment: paracetamol and piritin, two of each three times a day until
 * the 5th", the model had nowhere to put the second drug or the end, so both
 * went into the notes and the medication was saved as a single open-ended
 * drug. A proposal is now a medication holding any number of drugs, each with
 * its own amount, stock and schedule, plus an optional end date.
 */

export const FORM_TYPES = [
  'tablet',
  'capsule',
  'liquid',
  'injection',
  'cream',
  'inhaler',
  'patch',
  'drops',
  'other',
] as const;

const SCHEDULE_TYPES = ['interval', 'specific_times', 'as_needed'] as const;
const INTERVAL_UNITS = ['minutes', 'hours', 'days', 'weeks'] as const;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MAX_DRUGS = 10;

/**
 * The first dose of an interval schedule when the user named no time.
 *
 * Interval doses step from their first dose. With none given they used to
 * step from the start date's midnight UTC, or from the moment of creation, so
 * "every 8 hours" landed on times like 1am or 9:17pm. A morning default puts
 * the doses where people take them, and the card shows it so it can be fixed.
 */
export const DEFAULT_FIRST_DOSE_TIME = '08:00';

export interface ProposedDrug {
  name: string;
  dosageFormType: (typeof FORM_TYPES)[number];
  dosageAmount: number;
  dosageUnit?: string;
  route?: string;
  quantityOnHand?: number;
  refillThreshold?: number;
  scheduleType: (typeof SCHEDULE_TYPES)[number];
  intervalValue?: number;
  intervalUnit?: (typeof INTERVAL_UNITS)[number];
  /** 24h "HH:MM", in the user's timezone. */
  specificTimes?: string[];
  daysOfWeek?: string[];
  /** 24h "HH:MM" of the first interval dose, in the user's timezone. */
  firstDoseTime?: string;
  /** Legacy only: an absolute instant from a proposal stored before firstDoseTime. */
  firstDoseAt?: string;
}

export interface MedicationProposal {
  /** The medication's own label ("Flu Treatment"), not a drug or a dose. */
  name: string;
  notes?: string;
  /** YYYY-MM-DD. */
  startDate: string;
  /** YYYY-MM-DD, the last day of a course. Absent for an ongoing medication. */
  endDate?: string;
  drugs: ProposedDrug[];
}

type Raw = Record<string, unknown>;

const fail = (message: string): never => {
  throw new BadRequestException(message);
};

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const int = (v: unknown, field: string, min: number): number | undefined => {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min) {
    return fail(`${field} must be a whole number of at least ${min}`);
  }
  return n;
};

/** "2026-10-01" from a date or a datetime; anything else is an error. */
const isoDate = (v: unknown, field: string): string | undefined => {
  const s = str(v);
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return fail(`${field} must be a date in YYYY-MM-DD form`);
  const [, y, mo, d] = m.map(Number);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return fail(`${field} is not a real date`);
  }
  return m[0];
};

/** "8:00" → "08:00". The schema asks for 24h time; anything else is an error. */
const clockTime = (v: unknown, field: string): string => {
  const s = str(v) ?? '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    return fail(`${field} must be a 24-hour "HH:MM" time, got "${s}"`);
  }
  return `${m[1].padStart(2, '0')}:${m[2]}`;
};

/** "monday" or "MON" → "Mon", the form schedules store. */
const weekday = (v: unknown): string => {
  const s = (str(v) ?? '').slice(0, 3).toLowerCase();
  const day = WEEKDAYS.find((d) => d.toLowerCase() === s);
  return day ?? fail(`Unknown day of the week "${String(v)}"`);
};

function normalizeDrug(raw: Raw, fallbackName: string): ProposedDrug {
  const name = str(raw.name) ?? fallbackName;

  const formRaw = str(raw.dosageFormType)?.toLowerCase();
  const dosageFormType = FORM_TYPES.find((t) => t === formRaw) ?? 'other';

  const dosageAmount =
    int(raw.dosageAmount, `${name}: dosageAmount`, 1) ??
    fail(`${name}: dosageAmount is required`);

  // Legacy proposals carried as-needed as a flag as well as a type.
  const scheduleType =
    raw.asNeeded === true
      ? 'as_needed'
      : (SCHEDULE_TYPES.find((t) => t === raw.scheduleType) ??
        fail(
          `${name}: scheduleType must be interval, specific_times or as_needed`,
        ));

  const drug: ProposedDrug = {
    name,
    dosageFormType,
    dosageAmount,
    scheduleType,
  };

  const dosageUnit = str(raw.dosageUnit);
  if (dosageUnit) drug.dosageUnit = dosageUnit;
  const route = str(raw.route);
  if (route) drug.route = route;
  const stock = int(raw.quantityOnHand, `${name}: quantityOnHand`, 0);
  if (stock !== undefined) drug.quantityOnHand = stock;
  const threshold = int(raw.refillThreshold, `${name}: refillThreshold`, 0);
  if (threshold !== undefined) drug.refillThreshold = threshold;

  if (scheduleType === 'interval') {
    drug.intervalValue = int(raw.intervalValue, `${name}: intervalValue`, 1);
    const unit = str(raw.intervalUnit);
    if (unit) {
      drug.intervalUnit =
        INTERVAL_UNITS.find((u) => u === unit) ??
        fail(`${name}: intervalUnit must be minutes, hours, days or weeks`);
    }
    if (raw.firstDoseTime !== undefined) {
      drug.firstDoseTime = clockTime(
        raw.firstDoseTime,
        `${name}: firstDoseTime`,
      );
    }
    const legacyFirst = str(raw.firstDoseAt);
    if (legacyFirst && !Number.isNaN(Date.parse(legacyFirst))) {
      drug.firstDoseAt = legacyFirst;
    }
  }

  if (scheduleType === 'specific_times') {
    const times = Array.isArray(raw.specificTimes) ? raw.specificTimes : [];
    drug.specificTimes = [
      ...new Set(times.map((t) => clockTime(t, `${name}: specificTimes`))),
    ].sort();
  }

  if (Array.isArray(raw.daysOfWeek) && raw.daysOfWeek.length) {
    const days = new Set(raw.daysOfWeek.map(weekday));
    // All seven is the same as no filter; store it the way the wizard does.
    if (days.size < WEEKDAYS.length) {
      drug.daysOfWeek = WEEKDAYS.filter((d) => days.has(d));
    }
  }

  assertValidScheduleTypeFields({
    type: drug.scheduleType,
    intervalValue: drug.intervalValue,
    intervalUnit: drug.intervalUnit,
    specificTimes: drug.specificTimes,
  });

  return drug;
}

/**
 * Check and tidy a proposal, from the model's tool arguments or from a stored
 * pending action. Accepts the legacy single-drug shape (top-level dosage and
 * schedule fields), so a proposal saved before `drugs` existed can still be
 * confirmed. Throws BadRequestException with a message written for the model,
 * which gets it back as the tool result and can correct its arguments.
 */
export function normalizeProposal(raw: Raw): MedicationProposal {
  const name = str(raw.name) ?? fail('name is required');
  const startDate =
    isoDate(raw.startDate, 'startDate') ?? fail('startDate is required');
  const endDate = isoDate(raw.endDate, 'endDate');
  if (endDate && endDate < startDate) {
    fail(`endDate ${endDate} is before startDate ${startDate}`);
  }

  const rawDrugs = Array.isArray(raw.drugs)
    ? (raw.drugs.filter((d) => typeof d === 'object' && d !== null) as Raw[])
    : [raw];
  if (!rawDrugs.length) fail('drugs must list at least one drug');
  if (rawDrugs.length > MAX_DRUGS) {
    fail(`A medication can hold at most ${MAX_DRUGS} drugs`);
  }

  const proposal: MedicationProposal = {
    name,
    startDate,
    drugs: rawDrugs.map((d) => normalizeDrug(d, name)),
  };
  const notes = str(raw.notes);
  if (notes) proposal.notes = notes;
  if (endDate) proposal.endDate = endDate;
  return proposal;
}

/** The first interval dose as an instant: the start date at a local clock time. */
export function firstDoseInstant(
  startDate: string,
  time: string,
  timezone: string,
): Date {
  const [y, m, d] = startDate.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  try {
    return zonedTimeToUtc(y, m - 1, d, hh, mm, timezone);
  } catch {
    // Unknown zone: the server's own fallback, rather than failing the create.
    return zonedTimeToUtc(y, m - 1, d, hh, mm, 'UTC');
  }
}

/** The `createFull` request for a confirmed proposal: one dosage form per drug. */
export function toCreateFullDto(
  proposal: MedicationProposal,
  timezone: string,
): CreateFullMedicationDto {
  return {
    name: proposal.name,
    notes: proposal.notes,
    startDate: proposal.startDate,
    // createFull makes a medication with an end date a course, which stops
    // generating after it and is auto-completed by the 01:00 cron.
    ...(proposal.endDate ? { endDate: proposal.endDate } : {}),
    dosageForms: proposal.drugs.map((drug) => ({
      name: drug.name,
      type: drug.dosageFormType,
      dosageAmount: drug.dosageAmount,
      dosageUnit: drug.dosageUnit,
      route: drug.route,
      quantityOnHand: drug.quantityOnHand,
      refillThreshold: drug.refillThreshold,
      schedules: [
        {
          type: drug.scheduleType,
          intervalValue: drug.intervalValue,
          intervalUnit: drug.intervalUnit,
          specificTimes: drug.specificTimes,
          daysOfWeek: drug.daysOfWeek,
          firstDoseAt:
            drug.scheduleType !== 'interval'
              ? undefined
              : (drug.firstDoseAt ??
                firstDoseInstant(
                  proposal.startDate,
                  drug.firstDoseTime ?? DEFAULT_FIRST_DOSE_TIME,
                  timezone,
                ).toISOString()),
          timezone,
          asNeeded: drug.scheduleType === 'as_needed',
          isActive: true,
        },
      ],
    })),
  };
}
