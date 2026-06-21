import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsInt,
  IsArray,
  IsBoolean,
  IsIn,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SCHEDULE_TYPES } from '../../schedule/dto/create-schedule.dto';

export class FullScheduleDto {
  @ApiProperty({ description: 'interval | specific_times | as_needed' })
  @IsIn(SCHEDULE_TYPES)
  type: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  intervalValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  intervalUnit?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specificTimes?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  daysOfWeek?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  firstDoseAt?: string;

  @ApiPropertyOptional({ example: 'Africa/Lagos' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  asNeeded?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class FullDosageFormDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty()
  @IsInt()
  @IsNotEmpty()
  dosageAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dosageUnit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  route?: string;

  @ApiProperty({ type: [FullScheduleDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FullScheduleDto)
  schedules: FullScheduleDto[];
}

export class CreateFullMedicationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty()
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ type: [FullDosageFormDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FullDosageFormDto)
  dosageForms: FullDosageFormDto[];
}
