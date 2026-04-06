import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  /**
   * Placeholder for future BullMQ-based reminder scheduling.
   * Push notifications are currently handled by NotificationsService
   * via its EVERY_MINUTE cron. This service can be extended when
   * per-event delayed jobs (e.g. snooze, caregiver alerts) are needed.
   */
  async triggerGeneration() {
    this.logger.log(
      'triggerGeneration called — no-op until BullMQ jobs are implemented.',
    );
    return { success: true, message: 'No-op: push delivery handled by NotificationsService' };
  }
}
