import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInviteDto {
  @ApiPropertyOptional({
    description:
      'The owner\'s nickname for the invitee, e.g. "Mum". Shown while the invite is still pending, when there is no profile to read a name from.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}
