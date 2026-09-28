import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateNotificationPreferencesDto } from './dto/notification-preference.dto';
import { ClaimLocalRemindersDto } from './dto/local-reminders.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('preferences')
  @ApiOperation({
    summary: "The user's notification preferences (defaults when never saved)",
  })
  getPreferences(@Request() req) {
    return this.notificationsService.getPreferences(req.user.id);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update notification preferences' })
  updatePreferences(
    @Request() req,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(req.user.id, dto);
  }

  @Get('local-reminders')
  @ApiOperation({
    summary:
      'Dose reminders due in the next 48h, for the device to schedule on-phone',
  })
  getLocalReminders(@Request() req) {
    return this.notificationsService.getLocalReminderSnapshot(req.user.id);
  }

  @Put('local-reminders')
  @ApiOperation({
    summary:
      'Claim the reminders this device scheduled, so push skips them for this device',
  })
  claimLocalReminders(@Request() req, @Body() dto: ClaimLocalRemindersDto) {
    return this.notificationsService.claimLocalReminders(
      req.user.id,
      req.user.deviceId,
      dto.reminders,
    );
  }

  @Delete('local-reminders')
  @HttpCode(204)
  @ApiOperation({
    summary: "Release this device's claim; every dose goes back to push",
  })
  async releaseLocalReminders(@Request() req) {
    await this.notificationsService.releaseLocalReminders(
      req.user.id,
      req.user.deviceId,
    );
  }
}
