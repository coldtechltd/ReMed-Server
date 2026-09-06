import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCompanionLinkDto {
  @ApiPropertyOptional({
    description: 'Rename this companion.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({
    description: 'Push this companion when a dose is marked missed.',
  })
  @IsOptional()
  @IsBoolean()
  notifyMissedDose?: boolean;

  @ApiPropertyOptional({
    description: 'Push this companion when a medication is running low.',
  })
  @IsOptional()
  @IsBoolean()
  notifyRefill?: boolean;
}
