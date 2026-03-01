import { Controller, Post, UseGuards } from '@nestjs/common';
import { ReminderService } from './reminder.service';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('reminder')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reminder')
export class ReminderController {
  constructor(private readonly reminderService: ReminderService) {}

  @Post('trigger-generation')
  @ApiOperation({
    summary: 'Manually trigger background generation of upcoming dose events',
  })
  triggerGeneration() {
    return this.reminderService.triggerGeneration();
  }
}
