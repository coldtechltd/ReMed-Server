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
    description: 'For interval type, units e.g. minutes, hours, days',
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

  @ApiPropertyOptional({ description: 'Is PRN (as needed)?' })
  @IsOptional()
  @IsBoolean()
  asNeeded?: boolean;

  @ApiPropertyOptional({ description: 'Is schedule currently active?' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
