import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDoseEventDto {
  @ApiPropertyOptional({ description: 'Status: taken or missed' })
  @IsOptional()
  @IsString()
  status?: string;

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
