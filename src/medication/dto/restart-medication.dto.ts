import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RestartMedicationDto {
  @ApiPropertyOptional({
    description:
      'New start date. Defaults to keeping the existing one, which is usually what you want — ' +
      'generation never backfills the past anyway.',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'New end date. Required for a "course" whose existing end date has already passed, ' +
      'since an expired course cannot generate any dose events.',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
