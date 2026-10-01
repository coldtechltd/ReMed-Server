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

const DOSE_STATUSES = ['taken', 'partial', 'skipped', 'missed', 'pending'];

export class UpdateDoseEventDto {
  @ApiPropertyOptional({
    description:
      'Status. "skipped" is a deliberate choice not to take the dose and is ' +
      'kept out of the adherence rate; "missed" is a dose nobody logged. ' +
      '"partial" needs takenAmount. "pending" exists so a mis-tapped status ' +
      'can be undone — the hourly missed cron will re-evaluate it like any ' +
      'other pending dose.',
    enum: DOSE_STATUSES,
  })
  @IsOptional()
  @IsString()
  @IsIn(DOSE_STATUSES)
  status?: string;

  @ApiPropertyOptional({
    description:
      'For status=partial only: how much was actually taken, in the dosage ' +
      "form's unit. Must be less than the form's full dose.",
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  takenAmount?: number;

  @ApiPropertyOptional({
    description:
      'When the dose was actually taken, for logging a dose late or early ' +
      '("taken at 9:30, not 9:00"). Only meaningful with status=taken or ' +
      'partial; ' +
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
