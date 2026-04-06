import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConditionModule } from '../condition/condition.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [AuthModule, ConditionModule],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
