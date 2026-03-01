import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReminderService } from './reminder.service';
import { ReminderProcessor } from './reminder.processor';
import { ReminderController } from './reminder.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'reminders',
    }),
  ],
  controllers: [ReminderController],
  providers: [ReminderService, ReminderProcessor],
  exports: [ReminderService],
})
export class ReminderModule {}
