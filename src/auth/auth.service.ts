import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';

import { Inject } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  users,
  profiles,
  deviceSessions,
  medications,
  dosageForms,
  schedules,
  doseEvents,
  aiUsage,
  aiTipsCache,
  entitlements,
  passwordResetTokens,
  consentRecords,
  companionLinks,
} from '../db/schema';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { createPublicKey } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RegisterDto } from './dto/register.dto';
import { MailService } from '../common/mail/mail.service';
import { LAST_UPDATED as LEGAL_VERSION } from '../legal/legal.content';

const RESET_CODE_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  // Apple rotates its signing keys rarely; a short cache avoids fetching the
  // JWKS on every sign-in without risking a long stale window.
  private appleKeys: { keys: any[]; fetchedAt: number } | null = null;

  constructor(
    @Inject('DRIZZLE_CLIENT') private db: any,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
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
    await this.recordConsent(newUser.id);
    return this.generateTokens(newUser, false, session);
  }

  /**
   * Proof of ToS/privacy acceptance at signup. Versioned by the documents'
   * LAST_UPDATED string, so bumping the legal content naturally versions any
   * future re-acceptance. Best-effort: a consent-log hiccup must not block
   * account creation itself.
   */
  private async recordConsent(userId: string) {
    try {
      await this.db.insert(consentRecords).values([
        { userId, document: 'terms', version: LEGAL_VERSION },
        { userId, document: 'privacy', version: LEGAL_VERSION },
      ]);
    } catch {
      // logged nowhere better yet — the audit interceptor records the signup
    }
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

  // ---------------- ACCOUNT DELETION ------------------
  /**
   * Permanently deletes the account and everything it owns, in one
   * transaction (App Store 5.1.1(v) / Play policy both require an in-app
   * path for this). Audit logs are intentionally NOT touched — their userId
   * is a bare uuid with no FK precisely so the trail survives deletion.
   */
  async deleteAccount(userId: string) {
    await this.db.transaction(async (tx: any) => {
      const meds = await tx
        .select({ id: medications.id })
        .from(medications)
        .where(eq(medications.userId, userId));
      const medIds = meds.map((m: { id: string }) => m.id);

      if (medIds.length > 0) {
        const forms = await tx
          .select({ id: dosageForms.id })
          .from(dosageForms)
          .where(inArray(dosageForms.medicationId, medIds));
        const formIds = forms.map((f: { id: string }) => f.id);

        if (formIds.length > 0) {
          const scheds = await tx
            .select({ id: schedules.id })
            .from(schedules)
            .where(inArray(schedules.dosageFormId, formIds));
          const schedIds = scheds.map((s: { id: string }) => s.id);

          if (schedIds.length > 0) {
            await tx
              .delete(doseEvents)
              .where(inArray(doseEvents.scheduleId, schedIds));
            await tx.delete(schedules).where(inArray(schedules.id, schedIds));
          }
          await tx.delete(dosageForms).where(inArray(dosageForms.id, formIds));
        }
        await tx.delete(medications).where(eq(medications.userId, userId));
      }

      await tx.delete(aiUsage).where(eq(aiUsage.userId, userId));
      await tx.delete(aiTipsCache).where(eq(aiTipsCache.userId, userId));
      await tx.delete(entitlements).where(eq(entitlements.userId, userId));
      await tx
        .delete(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, userId));
      await tx.delete(consentRecords).where(eq(consentRecords.userId, userId));
      // Both directions: links this user granted, and links granted to them.
      // Missing either side leaves an FK pointing at a deleted user and the
      // whole account deletion fails.
      await tx
        .delete(companionLinks)
        .where(
          or(
            eq(companionLinks.ownerId, userId),
            eq(companionLinks.companionId, userId),
          ),
        );
      await tx.delete(profiles).where(eq(profiles.userId, userId));
      await tx.delete(deviceSessions).where(eq(deviceSessions.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });
    return { success: true };
  }

  // ---------------- PASSWORD RESET ------------------
  /**
   * Always resolves without revealing whether the address has an account
   * (and OAuth-only accounts, which have no password, behave identically).
   * The 6-digit code is stored bcrypt-hashed with a 15-minute TTL; asking
   * again invalidates earlier codes.
   */
  async requestPasswordReset(email: string) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    if (!user || !user.passwordHash) return;

    const code = String(randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(code, 10);

    await this.db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usedAt),
        ),
      );
    await this.db.insert(passwordResetTokens).values({
      userId: user.id,
      codeHash,
      expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
    });

    await this.mail.send(
      email,
      'Your ReMed password reset code',
      `<p>Use this code to reset your ReMed password:</p>
       <p style="font-size:2rem;letter-spacing:.3em;font-weight:700">${code}</p>
       <p>It expires in 15 minutes. If you didn't ask for this, you can ignore this email — your password is unchanged.</p>`,
    );
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    // One generic error for every failure mode, so responses can't be used
    // to probe which addresses exist or whether a code was "close".
    const invalid = () => new UnauthorizedException('Invalid or expired code');

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    if (!user) throw invalid();

    const [token] = await this.db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(passwordResetTokens.createdAt))
      .limit(1);
    if (!token) throw invalid();

    const matches = await bcrypt.compare(code, token.codeHash);
    if (!matches) throw invalid();

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.db.transaction(async (tx: any) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, token.id));
      // A reset means the old credential can't be trusted: revoke every
      // signed-in device (access + refresh tokens both check tokenVersion).
      await tx
        .update(deviceSessions)
        .set({ tokenVersion: sql`${deviceSessions.tokenVersion} + 1` })
        .where(eq(deviceSessions.userId, user.id));
    });
    return { success: true };
  }

  // ---------------- NATIVE OAUTH (mobile) ------------------
  /**
   * The app obtains a Google ID token via its native OAuth client and posts
   * it here; Google's tokeninfo endpoint does the signature/expiry check and
   * we verify the audience is one of our client ids.
   */
  private async verifyGoogleIdToken(
    idToken: string,
  ): Promise<{ oauthId: string; email: string }> {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!res.ok) throw new UnauthorizedException('Invalid Google token');
    const payload = await res.json();

    const allowedAudiences = [
      this.config.get<string>('GOOGLE_CLIENT_ID'),
      this.config.get<string>('GOOGLE_WEB_CLIENT_ID'),
      this.config.get<string>('GOOGLE_IOS_CLIENT_ID'),
      this.config.get<string>('GOOGLE_ANDROID_CLIENT_ID'),
    ].filter(Boolean);
    if (
      allowedAudiences.length === 0 ||
      !allowedAudiences.includes(payload.aud)
    ) {
      throw new UnauthorizedException('Invalid Google token');
    }
    if (payload.email_verified !== 'true' || !payload.email) {
      throw new UnauthorizedException('Google account email not verified');
    }
    return { oauthId: payload.sub, email: payload.email };
  }

  /**
   * Verifies an Apple identity token against Apple's published JWKS —
   * RS256 signature, issuer, and our bundle id as audience.
   */
  private async verifyAppleIdentityToken(
    identityToken: string,
  ): Promise<{ oauthId: string; email: string }> {
    const decoded = this.jwt.decode(identityToken, { complete: true });
    const kid = decoded?.header?.kid;
    if (!kid) throw new UnauthorizedException('Invalid Apple token');

    if (!this.appleKeys || Date.now() - this.appleKeys.fetchedAt > 600_000) {
      const res = await fetch('https://appleid.apple.com/auth/keys');
      if (!res.ok)
        throw new UnauthorizedException('Could not verify Apple token');
      this.appleKeys = {
        keys: (await res.json()).keys ?? [],
        fetchedAt: Date.now(),
      };
    }
    const jwk = this.appleKeys.keys.find((k) => k.kid === kid);
    if (!jwk) throw new UnauthorizedException('Invalid Apple token');

    const publicKey = createPublicKey({ key: jwk, format: 'jwk' })
      .export({ type: 'spki', format: 'pem' })
      .toString();

    let payload: any;
    try {
      payload = this.jwt.verify(identityToken, {
        publicKey,
        algorithms: ['RS256'],
        issuer: 'https://appleid.apple.com',
        audience:
          this.config.get<string>('APPLE_BUNDLE_ID') ?? 'com.coldtech.medapp',
      } as any);
    } catch {
      throw new UnauthorizedException('Invalid Apple token');
    }
    // First-party sign-ins always carry an email claim (a private-relay
    // address when the user hides theirs).
    if (!payload.email) throw new UnauthorizedException('Invalid Apple token');
    return { oauthId: payload.sub, email: payload.email };
  }

  /** Shared find-or-create for the native Google/Apple sign-in paths. */
  private async oauthLogin(
    provider: 'google' | 'apple',
    identity: { oauthId: string; email: string },
    deviceId: string,
  ) {
    const [byOauth] = await this.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.oauthProvider, provider),
          eq(users.oauthId, identity.oauthId),
        ),
      );

    let user = byOauth;
    if (!user) {
      const [byEmail] = await this.db
        .select()
        .from(users)
        .where(eq(users.email, identity.email));
      if (byEmail) {
        // Same verified email → link the provider to the existing account
        // instead of stranding the user with a duplicate.
        [user] = await this.db
          .update(users)
          .set({
            oauthProvider: provider,
            oauthId: identity.oauthId,
            updatedAt: new Date(),
          })
          .where(eq(users.id, byEmail.id))
          .returning();
      } else {
        [user] = await this.db
          .insert(users)
          .values({
            email: identity.email,
            oauthProvider: provider,
            oauthId: identity.oauthId,
          })
          .returning();
        await this.recordConsent(user.id);
      }
    }

    const session = await this.upsertDeviceSession(user.id, deviceId);
    const hasProfile = await this.hasUserProfile(user.id);
    return this.generateTokens(user, hasProfile, session);
  }

  async loginWithGoogleIdToken(idToken: string, deviceId: string) {
    const identity = await this.verifyGoogleIdToken(idToken);
    return this.oauthLogin('google', identity, deviceId);
  }

  async loginWithApple(identityToken: string, deviceId: string) {
    const identity = await this.verifyAppleIdentityToken(identityToken);
    return this.oauthLogin('apple', identity, deviceId);
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
    // The `type` claim is what stops an access token from being replayed
    // against /auth/refresh — both tokens are signed with the same secret,
    // so expiry alone can't tell them apart.
    const refreshToken = this.jwt.sign(
      { ...payload, type: 'refresh' },
      { expiresIn: '30d' },
    );

    return { accessToken, refreshToken, hasProfile };
  }

  // Exchange a valid refresh token for a fresh token pair (rotating the
  // refresh token too, so an active user never hits the 30-day cliff).
  // Revocation still works through the device session's tokenVersion: logout
  // bumps it, which invalidates outstanding refresh tokens as well.
  async refreshTokens(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub));
    if (!user) throw new UnauthorizedException('User no longer exists');

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

    await this.db
      .update(deviceSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(deviceSessions.id, session.id));

    const hasProfile = await this.hasUserProfile(user.id);
    return this.generateTokens(user, hasProfile, session);
  }
}
