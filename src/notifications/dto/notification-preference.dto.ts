import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Every field is optional — the client PATCHes only what changed. Remember the
 * global ValidationPipe runs `forbidNonWhitelisted`, so a field absent here is
 * a 400, not a silent no-op.
 */
export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({
    description:
      'Master switch for dose reminders. Unlike quiet hours this DOES silence doses, because it is an explicit, unambiguous user choice.',
  })
  @IsOptional()
  @IsBoolean()
  doseRemindersEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Predictive refill reminders.' })
  @IsOptional()
  @IsBoolean()
  refillRemindersEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Alerts about people you care for.' })
  @IsOptional()
  @IsBoolean()
  companionAlertsEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Mute refill and companion alerts overnight. Dose reminders are never muted by this.',
  })
  @IsOptional()
  @IsBoolean()
  quietHoursEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Quiet hours start, "HH:MM" 24h.' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'quietHoursStart must be "HH:MM" 24-hour',
  })
  quietHoursStart?: string;

  @ApiPropertyOptional({ description: 'Quiet hours end, "HH:MM" 24h.' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'quietHoursEnd must be "HH:MM" 24-hour',
  })
  quietHoursEnd?: string;

  @ApiPropertyOptional({
    description: 'Default snooze length. Matches the dose-event PATCH bounds.',
    minimum: 1,
    maximum: 180,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  defaultSnoozeMinutes?: number;

  @ApiPropertyOptional({ description: 'Home IANA timezone for quiet hours.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
