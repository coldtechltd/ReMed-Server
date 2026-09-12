import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckWarningsDto {
  @ApiProperty({
    description:
      'Names to check. The wizard sends the medication name together with each drug name, because users put the actual drug in either place — "Paracetamol" as the medication, or "Malaria Treatment" with Paracetamol as a dosage form.',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  names: string[];

  @ApiPropertyOptional({
    description:
      'Ignore this medication when checking for duplicates — used when editing an existing one.',
  })
  @IsOptional()
  @IsUUID()
  excludeMedicationId?: string;
}
