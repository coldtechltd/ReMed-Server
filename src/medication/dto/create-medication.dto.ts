import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiProperty({ description: 'When the treatment begins' })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiPropertyOptional({
    description: 'When the treatment ends (optional for ongoing treatments)',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
