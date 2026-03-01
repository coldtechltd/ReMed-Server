import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { DosageFormService } from '../dosage-form/dosage-form.service';

@Injectable()
export class ScheduleService {
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
        asNeeded: createDto.asNeeded ?? false,
        isActive: createDto.isActive ?? true,
      })
      .returning();

    await this.generateInitialDoseEvents(schedule.id, createDto);

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
  ) {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const limit = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now
    const eventTimes: Date[] = [];

    if (payload.type === 'specific_times' && payload.specificTimes) {
      const days = [startOfDay];
      const tomorrow = new Date(startOfDay);
      tomorrow.setDate(tomorrow.getDate() + 1);
      days.push(tomorrow);

      for (const day of days) {
        for (const timeStr of payload.specificTimes) {
          const [hours, minutes] = timeStr.split(':').map(Number);
          const eventTime = new Date(day);
          eventTime.setHours(hours, minutes, 0, 0);

          if (eventTime >= startOfDay && eventTime <= limit) {
            eventTimes.push(eventTime);
          }
        }
      }
    } else if (payload.type === 'interval' && payload.intervalValue) {
      let current = payload.firstDoseAt
        ? new Date(payload.firstDoseAt)
        : new Date(now);

      let msInterval = 0;
      if (payload.intervalUnit === 'hours')
        msInterval = payload.intervalValue * 60 * 60 * 1000;
      else if (payload.intervalUnit === 'minutes')
        msInterval = payload.intervalValue * 60 * 1000;
      else if (payload.intervalUnit === 'days')
        msInterval = payload.intervalValue * 24 * 60 * 60 * 1000;

      if (msInterval > 0) {
        if (current < startOfDay) {
          const diff = startOfDay.getTime() - current.getTime();
          const count = Math.ceil(diff / msInterval);
          current = new Date(current.getTime() + count * msInterval);
        }

        while (current <= limit) {
          if (current >= startOfDay) {
            eventTimes.push(new Date(current));
          }
          current = new Date(current.getTime() + msInterval);
        }
      }
    }

    if (eventTimes.length > 0) {
      const uniqueTimes = Array.from(
        new Set(eventTimes.map((t) => t.getTime())),
      ).map((t) => new Date(t));

      const values = uniqueTimes.map((time) => ({
        scheduleId: scheduleId,
        scheduledFor: time,
        status: 'pending',
      }));

      await this.db.insert(schema.doseEvents).values(values);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyDoseEventGeneration() {
    console.log('Running daily dose event generation...');
    const activeSchedules = await this.db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.isActive, true));

    for (const schedule of activeSchedules) {
      await this.generateInitialDoseEvents(schedule.id, schedule as any);
    }
    console.log('Finished daily dose event generation.');
  }
}
