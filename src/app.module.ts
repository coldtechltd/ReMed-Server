import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { DrizzleModule } from './db/drizzle.module';
import { AuthModule } from './auth/auth.module';
import { ProfileModule } from './profile/profile.module';
import { CountryModule } from './country/country.module';
import { ConditionModule } from './condition/condition.module';
import { MedicationModule } from './medication/medication.module';
import { DosageFormModule } from './dosage-form/dosage-form.module';
import { DoseEventModule } from './dose-event/dose-event.module';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from './notifications/notifications.module';
import { AiModule } from './ai/ai.module';

import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Global rate limiting: 100 requests / minute per IP by default.
    // Stricter limits are applied per-route via @Throttle (auth, AI).
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    DrizzleModule,
    AuthModule,
    ProfileModule,
    CountryModule,
    ConditionModule,
    MedicationModule,
    DosageFormModule,
    DoseEventModule,
    NotificationsModule,
    AiModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
