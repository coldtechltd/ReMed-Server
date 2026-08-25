import { IsOptional, IsString } from 'class-validator';

export class GoogleIdTokenDto {
  /** Google ID token obtained by the app via its native/OAuth client. */
  @IsString()
  idToken: string;
}

export class AppleSignInDto {
  /** Apple identity token from expo-apple-authentication. */
  @IsString()
  identityToken: string;

  /**
   * Apple only surfaces the name on the very first authorization; the client
   * forwards it so it isn't lost (currently informational — profile creation
   * collects the canonical name).
   */
  @IsOptional()
  @IsString()
  fullName?: string;
}
