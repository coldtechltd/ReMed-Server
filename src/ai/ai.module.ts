import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [ProfileModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
