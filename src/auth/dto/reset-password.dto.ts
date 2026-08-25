import { IsEmail, IsString, Length, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit number we emailed' })
  code: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}
