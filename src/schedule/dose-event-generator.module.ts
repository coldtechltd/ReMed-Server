import { Module } from '@nestjs/common';
import { DoseEventGeneratorService } from './dose-event-generator.service';

/**
 * Standalone so both ScheduleModule and MedicationModule can import it —
 * ScheduleModule already (transitively) imports MedicationModule, so the
 * generator can't live in either without creating a module cycle.
 */
@Module({
  providers: [DoseEventGeneratorService],
  exports: [DoseEventGeneratorService],
})
export class DoseEventGeneratorModule {}
