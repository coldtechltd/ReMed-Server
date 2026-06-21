import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';

import { Inject } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { users, profiles } from '../db/schema';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    @Inject('DRIZZLE_CLIENT') private db: any,
    private jwt: JwtService,
  ) {}

  // ---------------- LOCAL LOGIN ------------------
  async validateLocalUser(email: string, password: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const match = await bcrypt.compare(password, user.passwordHash || '');
    if (!match) throw new UnauthorizedException('Invalid credentials');

    return user;
  }

  async updatePushToken(userId: string, pushToken: string) {
    await this.db
      .update(users)
      .set({ expoPushToken: pushToken })
      .where(eq(users.id, userId));
  }

  // Invalidate all existing tokens for this user by incrementing tokenVersion.
  async logout(userId: string) {
    await this.db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, userId));
  }

  async hasUserProfile(userId: string): Promise<boolean> {
    const [profile] = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId));
    return !!profile;
  }

  // ---------------- REGISTER ------------------
  async register(registerDto: RegisterDto) {
    const { email, password } = registerDto;

    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));

    if (existing) {
      throw new BadRequestException('User already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [newUser] = await this.db
      .insert(users)
      .values({
        email,
        passwordHash,
      })
      .returning();

    return this.generateTokens(newUser, false);
  }

  // ---------------- GOOGLE LOGIN ------------------
  async validateGoogleUser({ profile, accessToken, refreshToken }) {
    const email = profile.emails[0].value;
    const oauthId = profile.id;

    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.oauthId, oauthId));

    if (existing) return existing;

    const newUser = await this.db
      .insert(users)
      .values({
        email,
        oauthProvider: 'google',
        oauthId,
        oauthAccessToken: accessToken,
        oauthRefreshToken: refreshToken,
      })
      .returning();

    return newUser[0];
  }

  // ---------------- TOKENS ------------------
  generateTokens(user: any, hasProfile: boolean) {
    const payload = {
      sub: user.id,
      email: user.email,
      tokenVersion: user.tokenVersion,
    };

    const accessToken = this.jwt.sign(payload, { expiresIn: '7d' });
    const refreshToken = this.jwt.sign(payload, { expiresIn: '30d' });

    return { accessToken, refreshToken, hasProfile };
  }
}
