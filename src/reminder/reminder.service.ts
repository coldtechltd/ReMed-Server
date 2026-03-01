import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, gt } from 'drizzle-orm';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    @InjectQueue('reminders') private readonly remindersQueue: Queue,
    @Inject(DRIZZLE_CLIENT) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  // In a real app, you would use @Cron to run this periodically.
  // We'll need to install @nestjs/schedule if we want the actual Cron,
  // or we can simulate it for now.
  //@Cron(CronExpression.EVERY_HOUR)
  async generateNextDoseEvents() {
    this.logger.log('Generating next dose events for active schedules...');

    const activeSchedules = await this.db.query.schedules.findMany({
      where: eq(schema.schedules.isActive, true),
      // Without manual setup of relations in Drizzle schema files,
      // we must fetch the relations manually, or loosely type it.
    });

    const now = new Date();
    // Generate events for the next 24 hours
    const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    for (const schedule of activeSchedules) {
      if (schedule.type === 'interval') {
        // simplified logic for demonstration:
        // find the last dose event to calculate next
      } else if (schedule.type === 'specific_times') {
        // simplified logic for specific times
      }

      // Let's create a dummy event right now to test the queue
      const dummyTakeAt = new Date(now.getTime() + 5000); // 5 seconds from now

      const [event] = await this.db
        .insert(schema.doseEvents)
        .values({
          scheduleId: schedule.id,
          status: 'pending',
          takenAt: dummyTakeAt,
        })
        .returning();

      // Fetch related dosage form and medication manually since drizzle relations
      // aren't fully configured in the provided schema
      const [dosageForm] = await this.db
        .select()
        .from(schema.dosageForms)
        .where(eq(schema.dosageForms.id, schedule.dosageFormId))
        .limit(1);
      const [medication] = await this.db
        .select()
        .from(schema.medications)
        .where(eq(schema.medications.id, dosageForm.medicationId))
        .limit(1);

      // Schedule the reminder job
      const delay = dummyTakeAt.getTime() - Date.now();
      await this.remindersQueue.add(
        'send-reminder',
        {
          eventId: event.id,
          userId: medication.userId,
          medicationName: medication.name,
          dosageFormName: dosageForm.name,
          amount: dosageForm.dosageAmount,
          unit: dosageForm.dosageUnit,
        },
        { delay: delay > 0 ? delay : 0 },
      );

      this.logger.log(`Scheduled reminder for event ${event.id} in ${delay}ms`);
    }
  }

  // Allow manual triggering of the generation
  async triggerGeneration() {
    await this.generateNextDoseEvents();
    return { success: true, message: 'Generation triggered' };
  }
}
