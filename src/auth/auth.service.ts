import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';

import { Inject } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { users, profiles, deviceSessions } from '../db/schema';
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

  // Creates (or touches) the session row for this specific device, so push
  // tokens and logout are scoped per-device instead of clobbering/affecting
  // every device the user is signed into.
  async upsertDeviceSession(
    userId: string,
    deviceId: string,
    pushToken?: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(deviceSessions)
      .where(
        and(
          eq(deviceSessions.userId, userId),
          eq(deviceSessions.deviceId, deviceId),
        ),
      );

    if (existing) {
      const updates: Record<string, unknown> = { lastSeenAt: new Date() };
      if (pushToken) updates.expoPushToken = pushToken;
      const [session] = await this.db
        .update(deviceSessions)
        .set(updates)
        .where(eq(deviceSessions.id, existing.id))
        .returning();
      return session;
    }

    const [session] = await this.db
      .insert(deviceSessions)
      .values({ userId, deviceId, expoPushToken: pushToken })
      .returning();
    return session;
  }

  async updatePushToken(userId: string, deviceId: string, pushToken: string) {
    return this.upsertDeviceSession(userId, deviceId, pushToken);
  }

  // Invalidate only this device's tokens by bumping its own tokenVersion —
  // other devices the user is signed into keep working.
  async logout(userId: string, deviceId: string) {
    await this.db
      .update(deviceSessions)
      .set({ tokenVersion: sql`${deviceSessions.tokenVersion} + 1` })
      .where(
        and(
          eq(deviceSessions.userId, userId),
          eq(deviceSessions.deviceId, deviceId),
        ),
      );
  }

  async hasUserProfile(userId: string): Promise<boolean> {
    const [profile] = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId));
    return !!profile;
  }

  // ---------------- REGISTER ------------------
  async register(registerDto: RegisterDto, deviceId: string) {
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

    const session = await this.upsertDeviceSession(newUser.id, deviceId);
    return this.generateTokens(newUser, false, session);
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
  generateTokens(
    user: any,
    hasProfile: boolean,
    session: { deviceId: string; tokenVersion: number },
  ) {
    const payload = {
      sub: user.id,
      email: user.email,
      deviceId: session.deviceId,
      tokenVersion: session.tokenVersion,
    };

    const accessToken = this.jwt.sign(payload, { expiresIn: '7d' });
    const refreshToken = this.jwt.sign(payload, { expiresIn: '30d' });

    return { accessToken, refreshToken, hasProfile };
  }
}
