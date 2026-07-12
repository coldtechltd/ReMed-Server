import {
  Controller,
  Post,
  Request,
  UseGuards,
  Get,
  Res,
  Body,
  Patch,
  Headers,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

// Clients that don't send an X-Device-Id (e.g. the OAuth browser redirect)
// all share this single session slot rather than crashing the request.
const FALLBACK_DEVICE_ID = 'unknown-device';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  // Brute-force protection: 5 attempts / minute per IP.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    const user = await this.auth.validateLocalUser(
      loginDto.email,
      loginDto.password,
    );

    const session = await this.auth.upsertDeviceSession(
      user.id,
      deviceId || FALLBACK_DEVICE_ID,
      loginDto.pushToken,
    );

    const hasProfile = await this.auth.hasUserProfile(user.id);
    return this.auth.generateTokens(user, hasProfile, session);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('signup')
  async signup(
    @Body() registerDto: RegisterDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.auth.register(registerDto, deviceId || FALLBACK_DEVICE_ID);
  }

  // ---------------- GOOGLE AUTH ------------------
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleLogin() {
    // Initiates the Google OAuth flow; the guard handles the redirect.
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Request() req,
    @Res() res,
    @Headers('x-device-id') deviceId?: string,
  ) {
    const hasProfile = await this.auth.hasUserProfile(req.user.id);
    const session = await this.auth.upsertDeviceSession(
      req.user.id,
      deviceId || FALLBACK_DEVICE_ID,
    );
    const tokens = this.auth.generateTokens(req.user, hasProfile, session);

    return res.json(tokens); // Or redirect with tokens
  }

  // ---------------- TEST PROTECTED ROUTE ------------------
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Request() req) {
    return req.user;
  }

  // ---------------- LOGOUT ------------------
  // Bumps only this device's tokenVersion — other signed-in devices are
  // unaffected.
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Request() req) {
    await this.auth.logout(req.user.id, req.user.deviceId);
    return { success: true, message: 'Logged out successfully' };
  }

  // ---------------- PUSH TOKEN ------------------
  @UseGuards(JwtAuthGuard)
  @Patch('push-token')
  async updatePushToken(@Request() req, @Body('token') token: string) {
    if (!token) {
      return { success: false, message: 'Token is required' };
    }
    await this.auth.updatePushToken(req.user.id, req.user.deviceId, token);
    return { success: true, message: 'Push token updated successfully' };
  }
}
