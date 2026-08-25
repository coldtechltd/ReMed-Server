import { IsISO8601, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LogDoseDto {
  @ApiProperty({ description: 'Dosage form the dose was taken from' })
  @IsString()
  dosageFormId: string;

  @ApiPropertyOptional({
    description:
      'When the dose was taken (ISO 8601). Defaults to now; must not be in the future.',
  })
  @IsOptional()
  @IsISO8601()
  takenAt?: string;
}
