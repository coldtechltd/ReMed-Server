import {
  IsString,
  IsIn,
  IsOptional,
  IsBoolean,
  IsInt,
  IsISO8601,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDoseEventDto {
  @ApiPropertyOptional({
    description:
      'Status. "pending" exists so a mis-tapped taken/missed can be undone — ' +
      'the hourly missed cron will re-evaluate it like any other pending dose.',
    enum: ['taken', 'missed', 'pending'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['taken', 'missed', 'pending'])
  status?: string;

  @ApiPropertyOptional({
    description:
      'When the dose was actually taken, for logging a dose late or early ' +
      '("taken at 9:30, not 9:00"). Only meaningful with status=taken; ' +
      'defaults to now. Must not be in the future.',
  })
  @IsOptional()
  @IsISO8601()
  takenAt?: string;

  @ApiPropertyOptional({ description: 'Was reminder sent?' })
  @IsOptional()
  @IsBoolean()
  reminderSent?: boolean;

  @ApiPropertyOptional({
    description:
      'Snooze the dose by this many minutes. Re-schedules the dose and re-arms its reminder.',
    minimum: 1,
    maximum: 180,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  snoozeMinutes?: number;
}
