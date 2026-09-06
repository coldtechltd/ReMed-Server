import { Module } from '@nestjs/common';
import { CompanionService } from './companion.service';
import { CompanionController } from './companion.controller';
import { JoinController } from './join.controller';
import { BillingModule } from '../billing/billing.module';
import { MedicationModule } from '../medication/medication.module';
import { DosageFormModule } from '../dosage-form/dosage-form.module';
import { DoseEventModule } from '../dose-event/dose-event.module';

@Module({
  // The read routes delegate to the owner-side services rather than
  // re-implementing their queries, so the companion view can't drift from the
  // owner's. BillingModule supplies the free/pro companion limit.
  imports: [BillingModule, MedicationModule, DosageFormModule, DoseEventModule],
  // JoinController is public (no JwtAuthGuard): it is the landing page a
  // forwarded invite link opens, before the recipient has an account.
  controllers: [CompanionController, JoinController],
  providers: [CompanionService],
  // NotificationsModule fans out missed-dose and refill pushes through this.
  exports: [CompanionService],
})
export class CompanionModule {}
