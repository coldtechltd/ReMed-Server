import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, lte, inArray } from 'drizzle-orm';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';

@Injectable()
export class NotificationsService {
  private expo: Expo;
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {
    this.expo = new Expo();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleReminders() {
    this.logger.debug('Checking for pending dose events to send reminders...');
    const now = new Date();

    try {
      const pendingDoses = await this.db
        .select({
          event: schema.doseEvents,
          medication: schema.medications,
          dosageForm: schema.dosageForms,
          user: schema.users,
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
        .innerJoin(schema.users, eq(schema.medications.userId, schema.users.id))
        .where(
          and(
            eq(schema.doseEvents.status, 'pending'),
            eq(schema.doseEvents.reminderSent, false),
            eq(schema.schedules.isActive, true),
            lte(schema.doseEvents.scheduledFor, now),
          ),
        );

      if (pendingDoses.length === 0) {
        return;
      }

      const messages: ExpoPushMessage[] = [];
      const eventIdsToUpdate: string[] = [];

      for (const dose of pendingDoses) {
        if (!dose.user.expoPushToken) continue;
        if (!Expo.isExpoPushToken(dose.user.expoPushToken)) {
          this.logger.error(
            `Push token ${dose.user.expoPushToken} is not a valid Expo push token`,
          );
          continue;
        }

        messages.push({
          to: dose.user.expoPushToken,
          sound: 'default',
          title: `Time to take ${dose.medication.name}`,
          body: `${dose.dosageForm.dosageAmount} ${dose.dosageForm.dosageUnit} of ${dose.dosageForm.name}`,
          data: { eventId: dose.event.id },
          categoryId: 'dose_reminder',
        });

        eventIdsToUpdate.push(dose.event.id);
      }

      if (messages.length === 0) return;

      const chunks = this.expo.chunkPushNotifications(messages);
      // Only mark events whose ticket actually came back 'ok'. messages and
      // eventIdsToUpdate are index-aligned; track an offset across chunks so a
      // failed chunk doesn't shift the mapping.
      const sentEventIds: string[] = [];
      let offset = 0;

      for (const chunk of chunks) {
        try {
          const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
          ticketChunk.forEach((ticket: ExpoPushTicket, i) => {
            const eventId = eventIdsToUpdate[offset + i];
            if (ticket.status === 'ok') {
              sentEventIds.push(eventId);
            } else {
              this.logger.error(
                `Push ticket error for event ${eventId}: ${ticket.message}`,
              );
            }
          });
        } catch (error) {
          this.logger.error('Error sending push notifications', error);
        }
        offset += chunk.length;
      }

      // Mark successfully-delivered events so they aren't re-sent. Failed ones
      // stay pending and will be retried on the next cron tick.
      if (sentEventIds.length > 0) {
        await this.db
          .update(schema.doseEvents)
          .set({ reminderSent: true })
          .where(inArray(schema.doseEvents.id, sentEventIds));
      }

      this.logger.log(`Sent ${sentEventIds.length} medication reminders.`);
    } catch (error: any) {
      const code = error?.cause?.code;
      if (code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'XX000') {
        this.logger.warn(`Database unavailable during reminder check (${code}). Retrying next minute.`);
      } else {
        this.logger.error(`Database error during reminder check: ${error.message || error}`);
      }
    }
  }
}
