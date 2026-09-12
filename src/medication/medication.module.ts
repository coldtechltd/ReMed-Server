import { Module } from '@nestjs/common';
import { MedicationService } from './medication.service';
import { MedicationController } from './medication.controller';
import { DoseEventGeneratorModule } from '../schedule/dose-event-generator.module';
import { MedicationNameModule } from '../medication-name/medication-name.module';

@Module({
  imports: [DoseEventGeneratorModule, MedicationNameModule],
  controllers: [MedicationController],
  providers: [MedicationService],
  exports: [MedicationService],
})
export class MedicationModule {}
