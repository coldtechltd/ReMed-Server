import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';

@Processor('reminders')
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly db: NodePgDatabase<typeof schema>,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { eventId, userId, medicationName, dosageFormName, amount, unit } =
      job.data;

    this.logger.log(`Processing reminder job ${job.id} for event ${eventId}`);
    this.logger.log(
      `🔔 NOTIFICATION for User ${userId}: Time to take ${amount} ${unit} of ${dosageFormName} (${medicationName})`,
    );

    // In a real application, you would integrate Firebase Cloud Messaging (FCM), APNs, SMS, or Email here.

    try {
      // Mark reminder as sent in DB
      await this.db
        .update(schema.doseEvents)
        .set({ reminderSent: true })
        .where(eq(schema.doseEvents.id, eventId));

      this.logger.log(`Successfully updated event ${eventId} reminder status.`);
    } catch (e) {
      this.logger.error(`Failed to update DB for event ${eventId}`, e);
    }

    return { sent: true };
  }
}
