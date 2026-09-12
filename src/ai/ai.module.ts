import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { MedicationModule } from '../medication/medication.module';
import { BillingModule } from '../billing/billing.module';
import { DoseEventModule } from '../dose-event/dose-event.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { MedicationContextService } from './medication-context.service';

@Module({
  imports: [ProfileModule, MedicationModule, BillingModule, DoseEventModule],
  controllers: [AiController],
  providers: [AiService, MedicationContextService],
})
export class AiModule {}
