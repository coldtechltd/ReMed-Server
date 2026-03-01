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
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

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

  @Post('signup')
  async signup(@Body() registerDto: RegisterDto) {
    return this.auth.register(registerDto);
  }

  // ---------------- GOOGLE AUTH ------------------
  @Get('google')
  @UseGuards()
  async googleLogin() {}

  @Get('google/callback')
  @UseGuards()
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
