import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { users, deviceSessions } from '../../db/schema';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    @Inject('DRIZZLE_CLIENT') private db: any,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub));

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    // Sessions are scoped per-device: reject only if *this device's* session
    // is missing or was revoked (e.g. by logout), so signing out on one
    // device doesn't invalidate every other device.
    const [session] = await this.db
      .select()
      .from(deviceSessions)
      .where(
        and(
          eq(deviceSessions.userId, payload.sub),
          eq(deviceSessions.deviceId, payload.deviceId),
        ),
      );

    if (
      !session ||
      (session.tokenVersion ?? 0) !== (payload.tokenVersion ?? 0)
    ) {
      throw new UnauthorizedException('Token has been revoked');
    }

    return { id: user.id, email: user.email, deviceId: session.deviceId };
  }
}
