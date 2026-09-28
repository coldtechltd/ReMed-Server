import { IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';
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

  @ApiPropertyOptional({
    description:
      'Client-generated UUID for this log, used as the dose event id. Makes the ' +
      'request idempotent: the app queues logs made offline and may replay one ' +
      'that already reached the server, and a replay must not log the dose (or ' +
      'debit stock) twice.',
  })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}
