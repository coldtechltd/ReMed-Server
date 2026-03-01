import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDoseEventDto {
  @ApiPropertyOptional({ description: 'Status: taken or missed' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Was reminder sent?' })
  @IsOptional()
  @IsBoolean()
  reminderSent?: boolean;
}
