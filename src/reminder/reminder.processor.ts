import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

/**
 * Placeholder processor for the 'reminders' BullMQ queue.
 * Reserved for future per-event delayed jobs (snooze, caregiver alerts, etc.).
 * Push notifications are currently sent by NotificationsService.
 */
@Processor('reminders')
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  async process(job: Job): Promise<any> {
    this.logger.log(`Received job ${job.id} (${job.name}) — no handler implemented yet.`);
    return { handled: false };
  }
}
