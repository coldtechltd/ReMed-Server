import {
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Post,
  Request,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EntitlementService, QUOTAS } from './entitlement.service';
import { RevenueCatEvent, parseEvent, storeToSource } from './revenuecat.types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape `JwtStrategy.validate` puts on the request. */
interface AuthenticatedRequest {
  user: { id: string; email: string; deviceId: string };
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly entitlements: EntitlementService,
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * What the app is allowed to do. The client's RevenueCat SDK decides what the
   * *UI* shows; this decides what the *API* permits, and they are intentionally
   * separate — a tampered client can change the former and not the latter.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current entitlement and today’s AI usage' })
  async me(@Request() req: AuthenticatedRequest) {
    const userId = req.user.id;
    const [status, usage] = await Promise.all([
      this.entitlements.getStatus(userId),
      this.entitlements.getUsageToday(userId),
    ]);

    return {
      tier: status.tier,
      isLifetime: status.isLifetime,
      expiresAt: status.expiresAt,
      productId: status.productId,
      usage: {
        tips: { used: usage.tips, limit: QUOTAS[status.tier].tips },
        chat: { used: usage.chat, limit: QUOTAS[status.tier].chat },
      },
    };
  }

  /**
   * RevenueCat webhook. Authenticated by the shared secret configured on their
   * dashboard, NOT by JwtAuthGuard — the caller is RevenueCat, not a user.
   *
   * Returns 200 for anything understood-but-not-actionable so RevenueCat stops
   * retrying; only a bad secret is rejected.
   */
  @Post('webhook')
  @ApiExcludeEndpoint()
  async webhook(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<{ received: boolean; applied?: string }> {
    const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!expected) {
      this.logger.error(
        'REVENUECAT_WEBHOOK_SECRET is not set — refusing webhook.',
      );
      throw new UnauthorizedException('Webhook not configured');
    }
    if (!authorization || !safeEqual(authorization, expected)) {
      this.logger.warn('Rejected RevenueCat webhook: bad shared secret.');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = (body as { event?: RevenueCatEvent })?.event;
    if (!event?.type) return { received: true, applied: 'no_event' };

    const userId = event.app_user_id ?? event.original_app_user_id;
    if (!userId || !UUID_RE.test(userId)) {
      // Anonymous RevenueCat id — the purchase happened before Purchases.logIn
      // associated it with an account. Nothing to attach it to yet.
      this.logger.warn(
        `RevenueCat event ${event.type} has no usable app_user_id.`,
      );
      return { received: true, applied: 'unknown_user' };
    }

    // Decide before touching the database. RevenueCat's dashboard "send test
    // event" button and any event type we don't model land here, and querying
    // for a user we're about to ignore turns a transient DB blip into a 500
    // that RevenueCat will retry for hours.
    const parsed = parseEvent(event);

    if (parsed.action === 'ignore') {
      return { received: true, applied: `ignored:${event.type}` };
    }

    const [user] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) {
      this.logger.warn(`RevenueCat event ${event.type} for unknown user.`);
      return { received: true, applied: 'unknown_user' };
    }

    if (parsed.action === 'revoke') {
      await this.entitlements.applyEntitlement({
        userId,
        tier: 'free',
        source: storeToSource(event.store),
        productId: event.product_id ?? null,
        expiresAt: null,
        isLifetime: false,
        rcAppUserId: event.app_user_id ?? null,
      });
      this.logger.log(`Revoked Pro for user ${userId} (${event.type}).`);
      return { received: true, applied: 'revoked' };
    }

    await this.entitlements.applyEntitlement({
      userId,
      tier: 'pro',
      source: storeToSource(event.store),
      productId: event.product_id ?? null,
      expiresAt: parsed.expiresAt,
      isLifetime: parsed.isLifetime,
      rcAppUserId: event.app_user_id ?? null,
    });

    this.logger.log(
      `Granted Pro to user ${userId} (${event.type}, lifetime=${parsed.isLifetime}).`,
    );
    return { received: true, applied: 'granted' };
  }
}
