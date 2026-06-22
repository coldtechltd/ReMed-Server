import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDosageFormDto {
  @ApiProperty({ description: 'The medication ID this form belongs to' })
  @IsUUID()
  @IsNotEmpty()
  medicationId: string;

  @ApiProperty({
    description: 'The name of the specific drug, e.g., "Paracetamol"',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Form type: pill, injection, liquid, cream' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: 'Quantity per dose, e.g., 2' })
  @IsInt()
  @IsNotEmpty()
  dosageAmount: number;

  @ApiPropertyOptional({ description: 'Unit of measurement, default: "pills"' })
  @IsOptional()
  @IsString()
  dosageUnit?: string;

  @ApiPropertyOptional({
    description: 'Route of administration, default: "oral"',
  })
  @IsOptional()
  @IsString()
  route?: string;

  @ApiPropertyOptional({
    description: 'Current stock on hand (units). Omit to not track refills.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantityOnHand?: number;

  @ApiPropertyOptional({
    description: 'Alert when stock falls to or below this. Default: 5',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  refillThreshold?: number;
}
