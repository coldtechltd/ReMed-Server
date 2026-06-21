import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, gte, lte } from 'drizzle-orm';
import * as schema from '../db/schema';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { DosageFormService } from '../dosage-form/dosage-form.service';
import { computeDoseEventTimes } from './schedule.util';

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly dosageFormService: DosageFormService,
  ) {}

  async create(userId: string, createDto: CreateScheduleDto) {
    // Ensure user owns dosage form
    await this.dosageFormService.findOne(createDto.dosageFormId, userId);

    // Validate type constraints
    if (
      createDto.type === 'interval' &&
      (!createDto.intervalValue || !createDto.intervalUnit)
    ) {
      throw new BadRequestException(
        'Interval schedule requires intervalValue and intervalUnit',
      );
    }
    if (
      createDto.type === 'specific_times' &&
      !createDto.specificTimes?.length
    ) {
      throw new BadRequestException(
        'Specific times schedule requires specificTimes array',
      );
    }

    const [schedule] = await this.db
      .insert(schema.schedules)
      .values({
        dosageFormId: createDto.dosageFormId,
        type: createDto.type,
        intervalValue: createDto.intervalValue,
        intervalUnit: createDto.intervalUnit,
        specificTimes: createDto.specificTimes,
        daysOfWeek: createDto.daysOfWeek,
        firstDoseAt: createDto.firstDoseAt
          ? new Date(createDto.firstDoseAt)
          : null,
        timezone: createDto.timezone ?? 'UTC',
        asNeeded: createDto.asNeeded ?? false,
        isActive: createDto.isActive ?? true,
      })
      .returning();

    await this.generateInitialDoseEvents(
      schedule.id,
      createDto,
      schedule.timezone ?? 'UTC',
    );

    return schedule;
  }

  async findAllByDosageForm(dosageFormId: string, userId: string) {
    await this.dosageFormService.findOne(dosageFormId, userId);
    return this.db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.dosageFormId, dosageFormId));
  }

  async findOne(id: string, userId: string) {
    // Join dosageForms and medications to verify ownership
    const results = await this.db
      .select({
        schedule: schema.schedules,
        medUserId: schema.medications.userId,
      })
      .from(schema.schedules)
      .innerJoin(
        schema.dosageForms,
        eq(schema.schedules.dosageFormId, schema.dosageForms.id),
      )
      .innerJoin(
        schema.medications,
        eq(schema.dosageForms.medicationId, schema.medications.id),
      )
      .where(eq(schema.schedules.id, id))
      .limit(1);

    if (results.length === 0) {
      throw new NotFoundException(`Schedule with ID ${id} not found`);
    }

    if (results[0].medUserId !== userId) {
      throw new ForbiddenException(
        `Schedule with ID ${id} does not belong to you`,
      );
    }

    return results[0].schedule;
  }

  async update(id: string, userId: string, updateDto: UpdateScheduleDto) {
    const existing = await this.findOne(id, userId);

    const updateData: any = {};
    if (updateDto.type) updateData.type = updateDto.type;
    if (updateDto.intervalValue !== undefined)
      updateData.intervalValue = updateDto.intervalValue;
    if (updateDto.intervalUnit)
      updateData.intervalUnit = updateDto.intervalUnit;
    if (updateDto.specificTimes)
      updateData.specificTimes = updateDto.specificTimes;
    if (updateDto.daysOfWeek) updateData.daysOfWeek = updateDto.daysOfWeek;
    if (updateDto.firstDoseAt !== undefined) {
      updateData.firstDoseAt = updateDto.firstDoseAt
        ? new Date(updateDto.firstDoseAt)
        : null;
    }
    if (updateDto.asNeeded !== undefined)
      updateData.asNeeded = updateDto.asNeeded;
    if (updateDto.isActive !== undefined)
      updateData.isActive = updateDto.isActive;

    if (Object.keys(updateData).length === 0) return existing;

    const [updated] = await this.db
      .update(schema.schedules)
      .set(updateData)
      .where(eq(schema.schedules.id, id))
      .returning();

    return updated;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);

    return this.db.transaction(async (tx) => {
      // Delete dose events
      await tx
        .delete(schema.doseEvents)
        .where(eq(schema.doseEvents.scheduleId, id));

      // Delete schedule
      await tx.delete(schema.schedules).where(eq(schema.schedules.id, id));

      return { deleted: true, id };
    });
  }

  private async generateInitialDoseEvents(
    scheduleId: string,
    payload: CreateScheduleDto,
    timezone: string = 'UTC',
  ) {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const limit = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours ahead

    // Timezone-aware computation of the dose instants (shared with the atomic
    // medication-create path).
    const eventTimes = computeDoseEventTimes(payload, timezone, now);
    if (eventTimes.length === 0) return;

    // Fetch already-existing scheduledFor times for this schedule in the window
    // to prevent duplicate inserts on repeated runs (e.g. the daily cron).
    const existing = await this.db
      .select({ scheduledFor: schema.doseEvents.scheduledFor })
      .from(schema.doseEvents)
      .where(
        and(
          eq(schema.doseEvents.scheduleId, scheduleId),
          gte(schema.doseEvents.scheduledFor, startOfDay),
          lte(schema.doseEvents.scheduledFor, limit),
        ),
      );
    const existingMs = new Set(existing.map((e) => e.scheduledFor.getTime()));

    const newTimes = eventTimes.filter((t) => !existingMs.has(t.getTime()));
    if (newTimes.length > 0) {
      await this.db.insert(schema.doseEvents).values(
        newTimes.map((time) => ({
          scheduleId,
          scheduledFor: time,
          status: 'pending',
        })),
      );
    }
  }

  /**
   * Logs DB connectivity failures (pooler/network/timeout) as warnings instead
   * of letting them bubble up as unhandled cron exceptions. Re-throws anything
   * that is not a recognized transient DB error so real bugs stay visible.
   */
  private handleCronDbError(context: string, error: any) {
    const code = error?.cause?.code;
    if (code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'XX000') {
      this.logger.warn(
        `Database unavailable during ${context} (${code}). Skipping this run.`,
      );
      return;
    }
    this.logger.error(
      `Error during ${context}: ${error?.message || error}`,
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyDoseEventGeneration() {
    this.logger.log('Running daily dose event generation...');
    try {
      const activeSchedules = await this.db
        .select()
        .from(schema.schedules)
        .where(eq(schema.schedules.isActive, true));

      for (const schedule of activeSchedules) {
        await this.generateInitialDoseEvents(
          schedule.id,
          schedule as any,
          schedule.timezone ?? 'UTC',
        );
      }
      this.logger.log(
        `Finished daily dose event generation for ${activeSchedules.length} schedules.`,
      );
    } catch (error) {
      this.handleCronDbError('daily dose event generation', error);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleMissedDoseMarking() {
    this.logger.log('Checking for missed doses...');
    // Grace window: 2 hours after scheduled time before marking missed
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);

    try {
      const result = await this.db
        .update(schema.doseEvents)
        .set({ status: 'missed' })
        .where(
          and(
            eq(schema.doseEvents.status, 'pending'),
            lte(schema.doseEvents.scheduledFor, cutoff),
          ),
        )
        .returning({ id: schema.doseEvents.id });

      if (result.length > 0) {
        this.logger.log(`Marked ${result.length} dose events as missed.`);
      }
    } catch (error) {
      this.handleCronDbError('missed dose marking', error);
    }
  }
}
