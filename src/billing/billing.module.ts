import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { EntitlementService } from './entitlement.service';

@Module({
  controllers: [BillingController],
  providers: [EntitlementService],
  // AiModule enforces quota through this service.
  exports: [EntitlementService],
})
export class BillingModule {}
