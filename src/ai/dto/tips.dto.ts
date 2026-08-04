import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class TipsDto {
  @ApiPropertyOptional({
    description:
      'Bypass the 24h cache and regenerate. Set only for an explicit user-initiated refresh, never on screen mount.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
