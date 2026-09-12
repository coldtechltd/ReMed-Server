import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsUUID,
  IsBoolean,
  IsArray,
  IsDateString,
  IsIn,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const SCHEDULE_TYPES = [
  'interval',
  'specific_times',
  'as_needed',
] as const;

export class CreateScheduleDto {
  @ApiProperty({ description: 'The dosage form ID this schedule belongs to' })
  @IsUUID()
  @IsNotEmpty()
  dosageFormId: string;

  @ApiProperty({
    description: 'Schedule type: interval, specific_times, as_needed',
  })
  @IsIn(SCHEDULE_TYPES)
  type: string;

  @ApiPropertyOptional({ description: 'For interval type, e.g. every 8 hours' })
  @IsOptional()
  @IsInt()
  intervalValue?: number;

  @ApiPropertyOptional({
    description:
      'For interval type: minutes, hours, days or weeks (weeks gives every-other-week dosing).',
  })
  @IsOptional()
  @IsString()
  intervalUnit?: string;

  @ApiPropertyOptional({
    description: 'For specific_times type, e.g. ["08:00", "20:00"]',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specificTimes?: string[];

  @ApiPropertyOptional({
    description: 'For specific_times type, days e.g. ["Mon", "Wed", "Fri"]',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  daysOfWeek?: string[];

  @ApiPropertyOptional({ description: 'When to start the schedule' })
  @IsOptional()
  @IsDateString()
  firstDoseAt?: string;

  @ApiPropertyOptional({
    description: 'IANA timezone the specific times are expressed in',
    example: 'Africa/Lagos',
  })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({
    description:
      'Cyclic regimen: days in the "on" phase (e.g. 21 for a 21/7 contraceptive). Requires cycleOffDays.',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  cycleOnDays?: number;

  @ApiPropertyOptional({
    description: 'Cyclic regimen: days in the "off" phase. Requires cycleOnDays.',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  cycleOffDays?: number;

  @ApiPropertyOptional({
    description:
      'Day 1 of the first on-phase. Defaults to the medication start date.',
  })
  @IsOptional()
  @IsDateString()
  cycleAnchorDate?: string;

  @ApiPropertyOptional({ description: 'Is PRN (as needed)?' })
  @IsOptional()
  @IsBoolean()
  asNeeded?: boolean;

  @ApiPropertyOptional({ description: 'Is schedule currently active?' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
