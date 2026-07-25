import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const MEDICATION_TYPES = ['continuous', 'course'] as const;
export type MedicationType = (typeof MEDICATION_TYPES)[number];

export const MEDICATION_STATUSES = ['active', 'completed'] as const;
export type MedicationStatus = (typeof MEDICATION_STATUSES)[number];

export class CreateMedicationDto {
  @ApiProperty({
    description:
      'The name of the medication treatment, e.g., "Malaria Treatment"',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Additional instructions or context for this treatment',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    enum: MEDICATION_TYPES,
    description:
      '"continuous" for medication taken indefinitely (no end date, eligible for refill reminders); ' +
      '"course" for a bounded treatment, which requires an endDate. ' +
      'Omitted by older clients — the server then derives it from whether endDate is present.',
  })
  @IsOptional()
  @IsIn(MEDICATION_TYPES)
  type?: MedicationType;

  @ApiProperty({ description: 'When the treatment begins' })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiPropertyOptional({
    description:
      'When the treatment ends. Required when type is "course"; ignored (stored as null) when type is "continuous".',
  })
  // Validate the format whenever a value is supplied, and additionally *require* a
  // value for a course. A bare @IsOptional would let "course with no end date"
  // through; a bare @ValidateIf(type === 'course') would skip format checking for
  // the older clients that send endDate without a type.
  @ValidateIf(
    (dto: CreateMedicationDto) => dto.type === 'course' || dto.endDate != null,
  )
  @IsDateString()
  @IsNotEmpty()
  endDate?: string;
}
