import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLocaleDto {
  @ApiProperty({
    description: "The device's IANA timezone",
    example: 'Africa/Lagos',
  })
  @IsString()
  @MaxLength(64)
  timezone: string;

  @ApiPropertyOptional({
    description: "The device's BCP 47 locale",
    example: 'en-GB',
  })
  @IsOptional()
  @IsString()
  @MaxLength(35)
  locale?: string;
}
