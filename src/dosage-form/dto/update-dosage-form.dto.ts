import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { CreateDosageFormDto } from './create-dosage-form.dto';

export class UpdateDosageFormDto extends PartialType(CreateDosageFormDto) {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 30,
    description:
      'Suppress refill reminders for this many days — backs the "Remind me later" ' +
      'action on a refill notification. Not a stored field; it just pushes the ' +
      'reminder latch into the future.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  snoozeRefillDays?: number;
}
