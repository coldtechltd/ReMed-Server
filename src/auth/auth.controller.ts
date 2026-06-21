import {
  Controller,
  Post,
  Request,
  UseGuards,
  Get,
  Res,
  Body,
  Patch,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  // Brute-force protection: 5 attempts / minute per IP.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    const user = await this.auth.validateLocalUser(
      loginDto.email,
      loginDto.password,
    );

    if (loginDto.pushToken) {
      await this.auth.updatePushToken(user.id, loginDto.pushToken);
    }

    const hasProfile = await this.auth.hasUserProfile(user.id);
    return this.auth.generateTokens(user, hasProfile);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('signup')
  async signup(@Body() registerDto: RegisterDto) {
    return this.auth.register(registerDto);
  }

  // ---------------- GOOGLE AUTH ------------------
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleLogin() {
    // Initiates the Google OAuth flow; the guard handles the redirect.
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Request() req, @Res() res) {
    const hasProfile = await this.auth.hasUserProfile(req.user.id);
    const tokens = this.auth.generateTokens(req.user, hasProfile);

    return res.json(tokens); // Or redirect with tokens
  }

  // ---------------- TEST PROTECTED ROUTE ------------------
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Request() req) {
    return req.user;
  }

  // ---------------- LOGOUT ------------------
  // Bumps the user's tokenVersion so every previously issued token is rejected.
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Request() req) {
    await this.auth.logout(req.user.id);
    return { success: true, message: 'Logged out successfully' };
  }

  // ---------------- PUSH TOKEN ------------------
  @UseGuards(JwtAuthGuard)
  @Patch('push-token')
  async updatePushToken(@Request() req, @Body('token') token: string) {
    if (!token) {
      return { success: false, message: 'Token is required' };
    }
    await this.auth.updatePushToken(req.user.id, token);
    return { success: true, message: 'Push token updated successfully' };
  }
}
