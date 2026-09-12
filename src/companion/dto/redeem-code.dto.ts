import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptInviteDto {
  @ApiProperty({ description: 'The invite code the owner shared.' })
  @IsString()
  @IsNotEmpty()
  // Generous vs. the 8-char code: users paste it with hyphens and spaces,
  // which normalizeInviteCode strips.
  @MaxLength(32)
  code: string;
}
