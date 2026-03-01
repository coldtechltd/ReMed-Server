import { Module } from '@nestjs/common';
import { DoseEventService } from './dose-event.service';
import { DoseEventController } from './dose-event.controller';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [ScheduleModule],
  controllers: [DoseEventController],
  providers: [DoseEventService],
  exports: [DoseEventService],
})
export class DoseEventModule {}
