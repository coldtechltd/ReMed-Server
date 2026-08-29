import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SentryCron } from '@sentry/nestjs';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, lt, desc, isNotNull, inArray } from 'drizzle-orm';
import * as schema from '../db/schema';
import {
  CreateMedicationDto,
  MedicationStatus,
  MedicationType,
} from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { CreateFullMedicationDto } from './dto/create-full-medication.dto';
import { RestartMedicationDto } from './dto/restart-medication.dto';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { CronLockService } from '../common/cron-lock/cron-lock.service';
import { DoseEventGeneratorService } from '../schedule/dose-event-generator.service';
import { endOfDayInTz } from '../schedule/schedule.util';

/**
 * Resolves the medication type and end date together, since they constrain each
 * other. Clients older than the type column omit `type` entirely, so fall back to
 * the only signal they gave us: whether an end date was supplied.
 */
function resolveTypeAndEndDate(dto: {
  type?: MedicationType;
  endDate?: string | null;
}): { type: MedicationType; endDate: Date | null } {
  const type: MedicationType =
    dto.type ?? (dto.endDate ? 'course' : 'continuous');
  // A continuous medication has no end, by definition — drop any stray date
  // rather than rejecting it, so a client switching type doesn't have to also
  // remember to blank the field.
  const endDate =
    type === 'continuous' || !dto.endDate ? null : new Date(dto.endDate);
  return { type, endDate };
}

@Injectable()
export class MedicationService {
  private readonly logger = new Logger(MedicationService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly doseEventGenerator: DoseEventGeneratorService,
    private readonly cronLock: CronLockService,
  ) {}

  /**
   * Create a medication together with all its dosage forms, schedules, and the
   * initial dose events — atomically. Either the whole tree is persisted or
   * nothing is, so a mid-way failure can't leave an orphaned half-medication.
   */
  async createFull(userId: string, dto: CreateFullMedicationDto) {
    const { type, endDate } = resolveTypeAndEndDate(dto);

    return this.db.transaction(async (tx) => {
      const [medication] = await tx
        .insert(schema.medications)
        .values({
          userId,
          name: dto.name,
          notes: dto.notes,
          type,
          startDate: new Date(dto.startDate),
          endDate,
        })
        .returning();

      for (const df of dto.dosageForms) {
        const [form] = await tx
          .insert(schema.dosageForms)
          .values({
            medicationId: medication.id,
            name: df.name,
            type: df.type,
            dosageAmount: df.dosageAmount,
            dosageUnit: df.dosageUnit,
            route: df.route,
            quantityOnHand: df.quantityOnHand,
            refillThreshold: df.refillThreshold,
          })
          .returning();

        for (const sch of df.schedules) {
          const tz = sch.timezone ?? 'UTC';
          const [schedule] = await tx
            .insert(schema.schedules)
            .values({
              dosageFormId: form.id,
              type: sch.type,
              intervalValue: sch.intervalValue,
              intervalUnit: sch.intervalUnit,
              specificTimes: sch.specificTimes,
              daysOfWeek: sch.daysOfWeek,
              firstDoseAt: sch.firstDoseAt ? new Date(sch.firstDoseAt) : null,
              timezone: tz,
              asNeeded: sch.asNeeded ?? false,
              isActive: sch.isActive ?? true,
            })
            .returning();

          await this.doseEventGenerator.generateForSchedule(
            schedule,
            {
              startDate: medication.startDate,
              endDate: medication.endDate,
              status: medication.status,
            },
            tx,
          );
        }
      }

      return medication;
    });
  }

  async create(userId: string, createMedicationDto: CreateMedicationDto) {
    const { type, endDate } = resolveTypeAndEndDate(createMedicationDto);

    const [medication] = await this.db
      .insert(schema.medications)
      .values({
        userId,
        name: createMedicationDto.name,
        notes: createMedicationDto.notes,
        type,
        startDate: new Date(createMedicationDto.startDate),
        endDate,
      })
      .returning();

    return medication;
  }

  async findAllByUser(userId: string, status?: MedicationStatus) {
    return this.db
      .select()
      .from(schema.medications)
      .where(
        status
          ? and(
              eq(schema.medications.userId, userId),
              eq(schema.medications.status, status),
            )
          : eq(schema.medications.userId, userId),
      )
      .orderBy(desc(schema.medications.createdAt));
  }

  async findOne(id: string, userId: string) {
    const [medication] = await this.db
      .select()
      .from(schema.medications)
      .where(
        and(
          eq(schema.medications.id, id),
          eq(schema.medications.userId, userId),
        ),
      )
      .limit(1);

    if (!medication) {
      throw new NotFoundException(`Medication with ID ${id} not found`);
    }

    return medication;
  }

  async update(
    id: string,
    userId: string,
    updateMedicationDto: UpdateMedicationDto,
  ) {
    const existing = await this.findOne(id, userId); // Ensure it exists and belongs to user

    // `!== undefined` rather than truthiness: notes and endDate must be clearable.
    // Converting a course to continuous depends on being able to null out endDate,
    // which a truthy check silently swallowed.
    const updateData: Partial<typeof schema.medications.$inferInsert> = {};
    if (updateMedicationDto.name !== undefined)
      updateData.name = updateMedicationDto.name;
    if (updateMedicationDto.notes !== undefined)
      updateData.notes = updateMedicationDto.notes;
    if (updateMedicationDto.startDate !== undefined)
      updateData.startDate = new Date(updateMedicationDto.startDate);

    // Type and endDate are coupled, so resolve them together against the merged
    // state: changing only the type must drag endDate along with it.
    if (
      updateMedicationDto.type !== undefined ||
      updateMedicationDto.endDate !== undefined
    ) {
      const type =
        updateMedicationDto.type ?? (existing.type as MedicationType);
      const rawEndDate =
        updateMedicationDto.endDate !== undefined
          ? updateMedicationDto.endDate
          : existing.endDate?.toISOString();
      if (type === 'course' && !rawEndDate) {
        throw new BadRequestException(
          'A course medication requires an end date. Provide endDate, or set type to "continuous".',
        );
      }
      const resolved = resolveTypeAndEndDate({ type, endDate: rawEndDate });
      updateData.type = resolved.type;
      updateData.endDate = resolved.endDate;
    }

    if (Object.keys(updateData).length === 0)
      return await this.findOne(id, userId);

    const [updatedMedication] = await this.db
      .update(schema.medications)
      .set(updateData)
      .where(
        and(
          eq(schema.medications.id, id),
          eq(schema.medications.userId, userId),
        ),
      )
      .returning();

    // Course dates bound event generation, so a changed startDate/endDate must
    // rebuild every schedule's future events: shrinking the course drops
    // now-out-of-range doses, extending it fills the horizon back in.
    if (
      updateData.startDate !== undefined ||
      updateData.endDate !== undefined
    ) {
      const scheduleRows = await this.schedulesFor(id);

      for (const row of scheduleRows) {
        await this.doseEventGenerator.regenerateForSchedule(row.schedule, {
          startDate: updatedMedication.startDate,
          endDate: updatedMedication.endDate,
          status: updatedMedication.status,
        });
      }
    }

    return updatedMedication;
  }

  /** Every schedule belonging to a medication, via its dosage forms. */
  private async schedulesFor(medicationId: string) {
    return this.db
      .select({ schedule: schema.schedules })
      .from(schema.schedules)
      .innerJoin(
        schema.dosageForms,
        eq(schema.schedules.dosageFormId, schema.dosageForms.id),
      )
      .where(eq(schema.dosageForms.medicationId, medicationId));
  }

  /**
   * Mark a medication finished: no more reminders, no more upcoming doses.
   *
   * Deliberately does NOT touch `schedules.isActive` — that flag is the user's
   * per-schedule reminder preference, and clobbering it here would lose their
   * settings for good. Reminder queries filter on `medications.status` instead,
   * so the two never disagree.
   */
  async complete(id: string, userId: string) {
    const medication = await this.findOne(id, userId);
    if (medication.status === 'completed') return medication;

    const scheduleRows = await this.schedulesFor(id);

    // One transaction: a medication left marked completed while its upcoming
    // doses survived would show as stopped but keep occupying the user's schedule.
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.medications)
        .set({ status: 'completed', completedAt: new Date() })
        .where(
          and(
            eq(schema.medications.id, id),
            eq(schema.medications.userId, userId),
          ),
        )
        .returning();

      // Drop every unresolved dose so nothing fires. Taken/missed history
      // survives, so adherence stats stay intact. Snoozed doses go too — the
      // treatment is over, so a deferred dose is no longer owed and would
      // otherwise sit in the user's upcoming list forever.
      //
      // Note this clears *past* pending doses as well, not just future ones:
      // a dose from earlier today that the user never resolved won't be
      // resolved now that they've stopped, and the hourly missed-marking cron
      // doesn't filter on medication status — it would flip those to "missed"
      // and leave a stopped medication counting against the day's progress
      // ring and the 30-day adherence rate.
      await this.doseEventGenerator.clearPending(
        scheduleRows.map((row) => row.schedule.id),
        tx,
        { includeSnoozed: true },
      );

      return updated;
    });
  }

  /**
   * Put a completed medication back into rotation and refill its dose-event horizon.
   */
  async restart(id: string, userId: string, dto: RestartMedicationDto) {
    const medication = await this.findOne(id, userId);

    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : medication.startDate;
    const endDate = dto.endDate
      ? new Date(dto.endDate)
      : medication.type === 'course'
        ? medication.endDate
        : null;

    // An expired course can't generate anything — the generation window closes
    // before it opens — so it would restart into a silent, doseless state.
    if (medication.type === 'course' && (!endDate || endDate <= new Date())) {
      throw new BadRequestException(
        'This treatment course has already ended. Provide a new endDate in the future to restart it.',
      );
    }

    const scheduleRows = await this.schedulesFor(id);

    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.medications)
        .set({ status: 'active', completedAt: null, startDate, endDate })
        .where(
          and(
            eq(schema.medications.id, id),
            eq(schema.medications.userId, userId),
          ),
        )
        .returning();

      for (const row of scheduleRows) {
        await this.doseEventGenerator.regenerateForSchedule(
          row.schedule,
          {
            startDate: updated.startDate,
            endDate: updated.endDate,
            status: updated.status,
          },
          tx,
        );
      }

      // Re-arm refill alerts: stock may well have been consumed or replaced while
      // this was parked.
      await tx
        .update(schema.dosageForms)
        .set({ refillReminderSentAt: null })
        .where(eq(schema.dosageForms.medicationId, id));

      return updated;
    });
  }

  /**
   * Auto-complete treatment courses whose end date has fully elapsed.
   *
   * `endDate` is inclusive *through end-of-day in the schedule's timezone*
   * (see DoseEventGeneratorService.generationWindow), but medications carry no
   * timezone of their own — their schedules do. A naive `end_date < now()` would
   * therefore retire a course up to ~35h early for a user west of UTC and then
   * delete that day's still-owed doses. So SQL only narrows to candidates, and the
   * real cutoff is `max(endOfDayInTz(endDate, tz))` across the medication's
   * schedule timezones: while any schedule still owes a dose today, the course
   * stays active.
   *
   * Runs after the midnight generation cron so a course that expires overnight is
   * cleaned up rather than topped up.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  @SentryCron('course-completion', {
    schedule: { type: 'crontab', value: '0 1 * * *' },
    checkinMargin: 60,
    maxRuntime: 15,
    timezone: 'UTC',
  })
  async handleCourseCompletion() {
    try {
      if (!(await this.cronLock.claim('course-completion', 86_400_000)))
        return;
      this.logger.log('Checking for treatment courses that have ended...');
      const now = new Date();

      // Candidates: any active course already past its bare endDate. The
      // timezone-accurate cutoff is applied below.
      const rows = await this.db
        .select({
          id: schema.medications.id,
          endDate: schema.medications.endDate,
          scheduleId: schema.schedules.id,
          timezone: schema.schedules.timezone,
        })
        .from(schema.medications)
        .leftJoin(
          schema.dosageForms,
          eq(schema.dosageForms.medicationId, schema.medications.id),
        )
        .leftJoin(
          schema.schedules,
          eq(schema.schedules.dosageFormId, schema.dosageForms.id),
        )
        .where(
          and(
            eq(schema.medications.type, 'course'),
            eq(schema.medications.status, 'active'),
            isNotNull(schema.medications.endDate),
            lt(schema.medications.endDate, now),
          ),
        );

      if (rows.length === 0) return;

      // Group the flattened join back into one entry per medication.
      const byMedication = new Map<
        string,
        { endDate: Date; timezones: string[]; scheduleIds: string[] }
      >();
      for (const row of rows) {
        if (!row.endDate) continue;
        const entry = byMedication.get(row.id) ?? {
          endDate: row.endDate,
          timezones: [],
          scheduleIds: [],
        };
        if (row.timezone) entry.timezones.push(row.timezone);
        if (row.scheduleId) entry.scheduleIds.push(row.scheduleId);
        byMedication.set(row.id, entry);
      }

      const expiredIds: string[] = [];
      const scheduleIdsToClear: string[] = [];
      for (const [medicationId, entry] of byMedication) {
        const timezones = entry.timezones.length ? entry.timezones : ['UTC'];
        const cutoff = Math.max(
          ...timezones.map((tz) => endOfDayInTz(entry.endDate, tz).getTime()),
        );
        if (now.getTime() <= cutoff) continue; // still owes doses somewhere
        expiredIds.push(medicationId);
        scheduleIdsToClear.push(...entry.scheduleIds);
      }

      if (expiredIds.length === 0) return;

      await this.db
        .update(schema.medications)
        .set({ status: 'completed', completedAt: now })
        .where(inArray(schema.medications.id, expiredIds));

      await this.doseEventGenerator.clearFuturePending(
        scheduleIdsToClear,
        this.db,
        now,
        { includeSnoozed: true },
      );

      this.logger.log(
        `Completed ${expiredIds.length} finished treatment course(s).`,
      );
    } catch (error: any) {
      const code = error?.cause?.code;
      if (code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'XX000') {
        this.logger.warn(
          `Database unavailable during course completion (${code}). Retrying tomorrow.`,
        );
      } else {
        this.logger.error(
          `Database error during course completion: ${error?.message || error}`,
        );
      }
    }
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId); // Ensure it exists and belongs to user

    // Handle cascading deletes manually via transaction
    return this.db.transaction(async (tx) => {
      // 1. Delete dose events related to schedules of dosage forms of this medication
      const forms = await tx
        .select({ id: schema.dosageForms.id })
        .from(schema.dosageForms)
        .where(eq(schema.dosageForms.medicationId, id));

      if (forms.length > 0) {
        const formIds = forms.map((f) => f.id);

        // Find schedules
        const schedulesRes = await tx
          .select({ id: schema.schedules.id })
          .from(schema.schedules)
          .where(inArray(schema.schedules.dosageFormId, formIds));

        const schedules = schedulesRes.map((sch) => sch.id);

        if (schedules.length > 0) {
          // Delete dose events
          await tx
            .delete(schema.doseEvents)
            .where(inArray(schema.doseEvents.scheduleId, schedules));
          // Delete schedules
          await tx
            .delete(schema.schedules)
            .where(inArray(schema.schedules.dosageFormId, formIds));
        }

        // Delete dosage forms
        await tx
          .delete(schema.dosageForms)
          .where(eq(schema.dosageForms.medicationId, id));
      }

      // Finally, delete the medication itself
      await tx.delete(schema.medications).where(eq(schema.medications.id, id));

      return { deleted: true, id };
    });
  }
}
