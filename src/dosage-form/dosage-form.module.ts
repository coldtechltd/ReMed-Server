import { Module } from '@nestjs/common';
import { DosageFormService } from './dosage-form.service';
import { DosageFormController } from './dosage-form.controller';
import { MedicationModule } from '../medication/medication.module';

@Module({
  imports: [MedicationModule],
  controllers: [DosageFormController],
  providers: [DosageFormService],
  exports: [DosageFormService],
})
export class DosageFormModule {}
