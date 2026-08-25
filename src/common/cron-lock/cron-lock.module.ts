import { Global, Module } from '@nestjs/common';
import { CronLockService } from './cron-lock.service';

// Global so the three cron-owning modules (notifications, schedule,
// medication) can inject the service without each importing this module.
@Global()
@Module({
  providers: [CronLockService],
  exports: [CronLockService],
})
export class CronLockModule {}
