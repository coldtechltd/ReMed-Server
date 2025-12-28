import { Controller, Post, Request, UseGuards, Get, Res, Body } from '@nestjs/common';
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

    return this.auth.generateTokens(user);
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
    const tokens = await this.auth.generateTokens(req.user);

    return res.json(tokens); // Or redirect with tokens
  }

  // ---------------- TEST PROTECTED ROUTE ------------------
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Request() req) {
    return req.user;
  }
}
