import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body of the deprecated `POST /companion/invites`.
 *
 * Nothing here is used any more — sharing codes are per user rather than per
 * invite, so there is no invitee to nickname at this point. The DTO is kept
 * only because `forbidNonWhitelisted` would 400 the already-shipped clients
 * that still send `{ label }`.
 */
export class CreateInviteDto {
  @ApiPropertyOptional({ deprecated: true, description: 'Ignored.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}
