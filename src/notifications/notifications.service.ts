import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, lte } from 'drizzle-orm';
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

    const pendingDoses = await this.db
      .select({
        event: schema.doseEvents,
        medication: schema.medications,
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
        title: 'Medication Reminder',
        body: `It's time to take your medication: ${dose.medication.name}`,
        data: { eventId: dose.event.id },
      });

      eventIdsToUpdate.push(dose.event.id);
    }

    if (messages.length === 0) return;

    const chunks = this.expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        this.logger.error('Error sending push notifications', error);
      }
    }

    // Mark as reminder sent
    if (eventIdsToUpdate.length > 0) {
      for (const id of eventIdsToUpdate) {
        await this.db
          .update(schema.doseEvents)
          .set({ reminderSent: true })
          .where(eq(schema.doseEvents.id, id));
      }
    }

    this.logger.log(`Sent ${messages.length} medication reminders.`);
  }
}
