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
  ValidateIf,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SCHEDULE_TYPES } from '../../schedule/dto/create-schedule.dto';
import { MEDICATION_TYPES } from './create-medication.dto';
import type { MedicationType } from './create-medication.dto';

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

  @ApiPropertyOptional({ description: 'Current stock on hand (units)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantityOnHand?: number;

  @ApiPropertyOptional({ description: 'Alert at/below this stock. Default: 5' })
  @IsOptional()
  @IsInt()
  @Min(0)
  refillThreshold?: number;

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

  @ApiPropertyOptional({
    enum: MEDICATION_TYPES,
    description:
      '"continuous" (indefinite, no end date) or "course" (bounded, endDate required). ' +
      'Derived from the presence of endDate when omitted.',
  })
  @IsOptional()
  @IsIn(MEDICATION_TYPES)
  type?: MedicationType;

  @ApiProperty()
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiPropertyOptional({
    description:
      'Required when type is "course"; stored as null when type is "continuous".',
  })
  @ValidateIf(
    (dto: CreateFullMedicationDto) =>
      dto.type === 'course' || dto.endDate != null,
  )
  @IsDateString()
  @IsNotEmpty()
  endDate?: string;

  @ApiProperty({ type: [FullDosageFormDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FullDosageFormDto)
  dosageForms: FullDosageFormDto[];
}
