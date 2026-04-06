import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { DrizzleModule } from './db/drizzle.module';
import { AuthModule } from './auth/auth.module';
import { ProfileModule } from './profile/profile.module';
import { CountryModule } from './country/country.module';
import { ConditionModule } from './condition/condition.module';
import { MedicationModule } from './medication/medication.module';
import { DosageFormModule } from './dosage-form/dosage-form.module';
import { ReminderModule } from './reminder/reminder.module';
import { DoseEventModule } from './dose-event/dose-event.module';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from './notifications/notifications.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST') || 'localhost',
          port: configService.get('REDIS_PORT') || 6379,
        },
      }),
      inject: [ConfigService],
    }),
    DrizzleModule,
    AuthModule,
    ProfileModule,
    CountryModule,
    ConditionModule,
    MedicationModule,
    DosageFormModule,
    ReminderModule,
    DoseEventModule,
    NotificationsModule,
    AiModule,
  ],
})
export class AppModule {}
