import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RedeemCodeDto {
  @ApiProperty({
    description:
      "The companion code the person you're joining shared with you.",
    example: 'ABCD2345',
  })
  @IsString()
  @IsNotEmpty()
  // Generous vs. the 8-char code: users paste it with hyphens and spaces,
  // which normalizeCompanionCode strips.
  @MaxLength(32)
  code: string;
}
