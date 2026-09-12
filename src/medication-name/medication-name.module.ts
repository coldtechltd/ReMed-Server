import { Module } from '@nestjs/common';
import { MedicationNameController } from './medication-name.controller';
import { MedicationNameService } from './medication-name.service';

@Module({
  controllers: [MedicationNameController],
  providers: [MedicationNameService],
  exports: [MedicationNameService],
})
export class MedicationNameModule {}
