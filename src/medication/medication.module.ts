import { Module } from '@nestjs/common';
import { MedicationService } from './medication.service';
import { MedicationController } from './medication.controller';
import { DoseEventGeneratorModule } from '../schedule/dose-event-generator.module';

@Module({
  imports: [DoseEventGeneratorModule],
  controllers: [MedicationController],
  providers: [MedicationService],
  exports: [MedicationService],
})
export class MedicationModule {}
