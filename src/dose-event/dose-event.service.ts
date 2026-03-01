import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, lte, and, desc } from 'drizzle-orm';
import * as schema from '../db/schema';
import { UpdateDoseEventDto } from './dto/update-dose-event.dto';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { ScheduleService } from '../schedule/schedule.service';

@Injectable()
export class DoseEventService {
  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly scheduleService: ScheduleService,
  ) {}

  async findAllByUser(userId: string) {
    // This requires joining doseEvents -> schedules -> dosageForms -> medications
    // Drizzle query API doesn't support deep nested mapping easily without custom manual mapping,
    // so we'll do an inner join to fetch events strictly belonging to the user
    const results = await this.db
      .select({ event: schema.doseEvents })
      .from(schema.doseEvents)
      .innerJoin(
        schema.schedules,
        eq(schema.doseEvents.scheduleId, schema.schedules.id),
      )
      .innerJoin(
        schema.dosageForms,
        eq(schema.schedules.dosageFormId, schema.dosageForms.id),
      )
      .innerJoin(
        schema.medications,
        eq(schema.dosageForms.medicationId, schema.medications.id),
      )
      .where(eq(schema.medications.userId, userId))
      .orderBy(desc(schema.doseEvents.takenAt));

    return results.map((r) => r.event);
  }

  async getUpcoming(userId: string) {
    const results = await this.db
      .select({ event: schema.doseEvents })
      .from(schema.doseEvents)
      .innerJoin(
        schema.schedules,
        eq(schema.doseEvents.scheduleId, schema.schedules.id),
      )
      .innerJoin(
        schema.dosageForms,
        eq(schema.schedules.dosageFormId, schema.dosageForms.id),
      )
      .innerJoin(
        schema.medications,
        eq(schema.dosageForms.medicationId, schema.medications.id),
      )
      .where(
        and(
          eq(schema.medications.userId, userId),
          eq(schema.doseEvents.status, 'pending'),
        ),
      )
      .orderBy(schema.doseEvents.takenAt);

    return results.map((r) => r.event);
  }

  async findOne(id: string, userId: string) {
    const results = await this.db
      .select({
        event: schema.doseEvents,
        medUserId: schema.medications.userId,
      })
      .from(schema.doseEvents)
      .innerJoin(
        schema.schedules,
        eq(schema.doseEvents.scheduleId, schema.schedules.id),
      )
      .innerJoin(
        schema.dosageForms,
        eq(schema.schedules.dosageFormId, schema.dosageForms.id),
      )
      .innerJoin(
        schema.medications,
        eq(schema.dosageForms.medicationId, schema.medications.id),
      )
      .where(eq(schema.doseEvents.id, id))
      .limit(1);

    if (results.length === 0) {
      throw new NotFoundException(`Dose event with ID ${id} not found`);
    }

    if (results[0].medUserId !== userId) {
      throw new ForbiddenException(
        `Dose event with ID ${id} does not belong to you`,
      );
    }

    return results[0].event;
  }

  async update(id: string, userId: string, updateDto: UpdateDoseEventDto) {
    const existing = await this.findOne(id, userId);

    const updateData: any = {};
    if (updateDto.status) updateData.status = updateDto.status;
    if (updateDto.reminderSent !== undefined)
      updateData.reminderSent = updateDto.reminderSent;

    if (Object.keys(updateData).length === 0) return existing;

    const [updated] = await this.db
      .update(schema.doseEvents)
      .set(updateData)
      .where(eq(schema.doseEvents.id, id))
      .returning();

    return updated;
  }
}
