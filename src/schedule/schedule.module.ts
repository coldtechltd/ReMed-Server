import { Module } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { ScheduleController } from './schedule.controller';
import { DosageFormModule } from '../dosage-form/dosage-form.module';
import { DoseEventGeneratorModule } from './dose-event-generator.module';

@Module({
  imports: [DosageFormModule, DoseEventGeneratorModule],
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
