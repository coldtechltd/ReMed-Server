import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import { CreateDosageFormDto } from './dto/create-dosage-form.dto';
import { UpdateDosageFormDto } from './dto/update-dosage-form.dto';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { MedicationService } from '../medication/medication.service';
import { endOfDayInTz, startOfDayInTz } from '../schedule/schedule.util';

@Injectable()
export class DosageFormService {
  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly medicationService: MedicationService,
  ) {}

  async create(userId: string, createDto: CreateDosageFormDto) {
    // Ensure the medication belongs to the user
    await this.medicationService.findOne(createDto.medicationId, userId);

    const [form] = await this.db
      .insert(schema.dosageForms)
      .values({
        medicationId: createDto.medicationId,
        name: createDto.name,
        type: createDto.type,
        dosageAmount: createDto.dosageAmount,
        dosageUnit: createDto.dosageUnit,
        route: createDto.route,
        quantityOnHand: createDto.quantityOnHand,
        refillThreshold: createDto.refillThreshold,
      })
      .returning();

    return form;
  }

  /**
   * The user's PRN ("as needed") dosage forms, with how many doses they've
   * already logged today.
   *
   * PRN schedules materialize no dose events, so these medications are
   * invisible to every dose-event read path — without this the home screen
   * simply cannot show them, and the only way to log one is to navigate to
   * its dosage-form detail screen.
   *
   * Not filtered on `schedules.isActive`: that flag is the *reminder* toggle,
   * and PRN doses never generate reminders, so honouring it here would hide a
   * usable medication for a reason that doesn't apply to it.
   */
  async findAsNeeded(userId: string, tz?: string) {
    const zone = tz || 'UTC';
    const now = new Date();
    let dayStart: Date;
    let dayEnd: Date;
    try {
      dayStart = startOfDayInTz(now, zone);
      dayEnd = endOfDayInTz(now, zone);
    } catch {
      // Invalid IANA zone — degrade to server-local rather than 500ing, the
      // same way every other day-bounded read in this codebase does.
      dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      dayEnd = new Date(now);
      dayEnd.setHours(23, 59, 59, 999);
    }

    const rows = await this.db
      .select({
        id: schema.dosageForms.id,
        name: schema.dosageForms.name,
        type: schema.dosageForms.type,
        dosageAmount: schema.dosageForms.dosageAmount,
        dosageUnit: schema.dosageForms.dosageUnit,
        quantityOnHand: schema.dosageForms.quantityOnHand,
        refillThreshold: schema.dosageForms.refillThreshold,
        medicationId: schema.medications.id,
        medicationName: schema.medications.name,
      })
      .from(schema.dosageForms)
      .innerJoin(
        schema.medications,
        eq(schema.dosageForms.medicationId, schema.medications.id),
      )
      .innerJoin(
        schema.schedules,
        eq(schema.schedules.dosageFormId, schema.dosageForms.id),
      )
      .where(
        and(
          eq(schema.medications.userId, userId),
          eq(schema.medications.status, 'active'),
          or(
            eq(schema.schedules.type, 'as_needed'),
            eq(schema.schedules.asNeeded, true),
          ),
        ),
      )
      .groupBy(schema.dosageForms.id, schema.medications.id);

    if (rows.length === 0) return [];

    // One grouped count for every form, rather than a query per form.
    const counts = await this.db
      .select({
        dosageFormId: schema.schedules.dosageFormId,
        takenToday: sql<number>`count(*)::int`,
      })
      .from(schema.doseEvents)
      .innerJoin(
        schema.schedules,
        eq(schema.doseEvents.scheduleId, schema.schedules.id),
      )
      .where(
        and(
          inArray(
            schema.schedules.dosageFormId,
            rows.map((r) => r.id),
          ),
          eq(schema.doseEvents.status, 'taken'),
          gte(schema.doseEvents.takenAt, dayStart),
          lte(schema.doseEvents.takenAt, dayEnd),
        ),
      )
      .groupBy(schema.schedules.dosageFormId);

    const countByForm = new Map(
      counts.map((c) => [c.dosageFormId, c.takenToday]),
    );

    return rows.map((r) => ({ ...r, takenToday: countByForm.get(r.id) ?? 0 }));
  }

  async findAllByMedication(
    medicationId: string,
    userId: string,
    opts?: { excludePrivate?: boolean },
  ) {
    // Ensure user owns medication. With excludePrivate this also 404s a
    // private medication, so a companion can't reach its forms by id.
    await this.medicationService.findOne(medicationId, userId, opts);

    return this.db
      .select()
      .from(schema.dosageForms)
      .where(eq(schema.dosageForms.medicationId, medicationId));
  }

  async findOne(id: string, userId: string) {
    // Join with medication to check ownership
    const formsWithMeds = await this.db
      .select({
        form: schema.dosageForms,
        medUserId: schema.medications.userId,
      })
      .from(schema.dosageForms)
      .innerJoin(
        schema.medications,
        eq(schema.dosageForms.medicationId, schema.medications.id),
      )
      .where(eq(schema.dosageForms.id, id))
      .limit(1);

    if (formsWithMeds.length === 0) {
      throw new NotFoundException(`Dosage form with ID ${id} not found`);
    }

    if (formsWithMeds[0].medUserId !== userId) {
      throw new ForbiddenException(
        `Dosage form with ID ${id} does not belong to you`,
      );
    }

    return formsWithMeds[0].form;
  }

  async update(id: string, userId: string, updateDto: UpdateDosageFormDto) {
    const existing = await this.findOne(id, userId);

    const updateData: any = {};
    if (updateDto.name) updateData.name = updateDto.name;
    if (updateDto.type) updateData.type = updateDto.type;
    if (updateDto.dosageAmount !== undefined)
      updateData.dosageAmount = updateDto.dosageAmount;
    if (updateDto.dosageUnit) updateData.dosageUnit = updateDto.dosageUnit;
    if (updateDto.route) updateData.route = updateDto.route;
    if (updateDto.quantityOnHand !== undefined) {
      updateData.quantityOnHand = updateDto.quantityOnHand;
      // Re-arm the predictive refill reminder: the stock count just changed, so
      // whatever we last projected (and alerted on) is stale.
      updateData.refillReminderSentAt = null;
    }
    if (updateDto.refillThreshold !== undefined)
      updateData.refillThreshold = updateDto.refillThreshold;
    // "Remind me later" on a refill notification: dating the latch forward keeps
    // the daily cron quiet until then (its predicate only fires on a latch older
    // than 20h, which a future timestamp never satisfies).
    if (updateDto.snoozeRefillDays !== undefined) {
      updateData.refillReminderSentAt = new Date(
        Date.now() + updateDto.snoozeRefillDays * 24 * 60 * 60 * 1000,
      );
    }

    if (Object.keys(updateData).length === 0) return existing;

    const [updated] = await this.db
      .update(schema.dosageForms)
      .set(updateData)
      .where(eq(schema.dosageForms.id, id))
      .returning();

    return updated;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);

    return this.db.transaction(async (tx) => {
      // Find schedules
      const schedulesRes = await tx
        .select({ id: schema.schedules.id })
        .from(schema.schedules)
        .where(eq(schema.schedules.dosageFormId, id));

      const schedules = schedulesRes.map((sch) => sch.id);

      if (schedules.length > 0) {
        // Delete dose events
        await tx
          .delete(schema.doseEvents)
          .where(inArray(schema.doseEvents.scheduleId, schedules));
        // Delete schedules
        await tx
          .delete(schema.schedules)
          .where(eq(schema.schedules.dosageFormId, id));
      }

      // Delete dosage form
      await tx.delete(schema.dosageForms).where(eq(schema.dosageForms.id, id));

      return { deleted: true, id };
    });
  }
}
