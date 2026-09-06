import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';

export type Tier = 'free' | 'pro';
export type AiCallKind = 'tips' | 'chat';

/** Error code the app matches on to decide whether to open the paywall. */
export const AI_QUOTA_EXCEEDED = 'AI_QUOTA_EXCEEDED';

/**
 * Daily allowances. Free-tier numbers are the product decision; Pro numbers are
 * abuse ceilings, not a feature limit — a real person never approaches them, but
 * a stolen token or a runaway client would otherwise bill us indefinitely.
 */
export const QUOTAS: Record<Tier, Record<AiCallKind, number>> = {
  free: { tips: 1, chat: 5 },
  pro: { tips: 20, chat: 200 },
};

/**
 * Distinct from AI_QUOTA_EXCEEDED on purpose: the app's `isQuotaError()` guard
 * matches that code and opens the paywall with AI-usage copy, which would be
 * the wrong message here.
 */
export const COMPANION_LIMIT_REACHED = 'COMPANION_LIMIT_REACHED';

/**
 * How many people a user may share their medications WITH. Not a daily counter,
 * so it deliberately sits outside QUOTAS (whose lookup is keyed to the
 * ai_usage columns). Being someone else's companion is always free and
 * unlimited — charging for that would break the caregiver case, which is
 * usually why the second person installs the app at all.
 */
export const COMPANION_LIMITS: Record<Tier, number> = {
  free: 1,
  pro: 5,
};

export interface EntitlementStatus {
  tier: Tier;
  isLifetime: boolean;
  expiresAt: Date | null;
  productId: string | null;
}

export interface UsageToday {
  tips: number;
  chat: number;
}

@Injectable()
export class EntitlementService {
  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /** UTC calendar day, matching `ai_usage.day`. */
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async getStatus(userId: string): Promise<EntitlementStatus> {
    const [row] = await this.db
      .select()
      .from(schema.entitlements)
      .where(eq(schema.entitlements.userId, userId))
      .limit(1);

    if (!row || row.tier !== 'pro') {
      return {
        tier: 'free',
        isLifetime: false,
        expiresAt: null,
        productId: null,
      };
    }

    // A lifetime purchase never lapses. Otherwise the stored expiry decides,
    // so a webhook we never received can only ever cost us revenue, never
    // hand out access we aren't being paid for.
    const active =
      row.isLifetime || (row.expiresAt !== null && row.expiresAt > new Date());

    return {
      tier: active ? 'pro' : 'free',
      isLifetime: row.isLifetime,
      expiresAt: row.expiresAt,
      productId: row.productId,
    };
  }

  async getTier(userId: string): Promise<Tier> {
    return (await this.getStatus(userId)).tier;
  }

  async isPro(userId: string): Promise<boolean> {
    return (await this.getTier(userId)) === 'pro';
  }

  async getUsageToday(userId: string): Promise<UsageToday> {
    const [row] = await this.db
      .select()
      .from(schema.aiUsage)
      .where(
        and(
          eq(schema.aiUsage.userId, userId),
          eq(schema.aiUsage.day, this.today()),
        ),
      )
      .limit(1);

    return { tips: row?.tipsCalls ?? 0, chat: row?.chatCalls ?? 0 };
  }

  /**
   * Throws 402 when the caller has spent today's allowance for `kind`.
   *
   * Call this *before* the model request, and `recordUsage` after — counting on
   * the way out would let a failed generation burn a user's allowance.
   */
  async assertQuota(userId: string, kind: AiCallKind): Promise<Tier> {
    const tier = await this.getTier(userId);
    const limit = QUOTAS[tier][kind];
    const used = (await this.getUsageToday(userId))[kind];

    if (used >= limit) {
      throw new HttpException(
        {
          code: AI_QUOTA_EXCEEDED,
          kind,
          tier,
          limit,
          used,
          message:
            tier === 'free'
              ? 'You have used your free AI allowance for today. Upgrade to ReMed Pro for more.'
              : 'Daily AI limit reached. Please try again tomorrow.',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return tier;
  }

  /**
   * Throws 402 when the owner already has as many companion links as their
   * tier allows. Pending invites count: an unredeemed code is a seat held.
   */
  async assertCompanionLimit(userId: string): Promise<Tier> {
    const tier = await this.getTier(userId);
    const limit = COMPANION_LIMITS[tier];

    const [row] = await this.db
      .select({ used: sql<number>`count(*)::int` })
      .from(schema.companionLinks)
      .where(
        and(
          eq(schema.companionLinks.ownerId, userId),
          inArray(schema.companionLinks.status, ['pending', 'active']),
        ),
      );
    const used = row?.used ?? 0;

    if (used >= limit) {
      throw new HttpException(
        {
          code: COMPANION_LIMIT_REACHED,
          tier,
          limit,
          used,
          message:
            tier === 'free'
              ? 'Free accounts can share with one companion. Upgrade to ReMed Pro to add more.'
              : `You can share with up to ${limit} companions.`,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return tier;
  }

  /**
   * Increments today's counters. Token counts come from the provider's
   * `usage` block, so this doubles as the per-user cost ledger.
   */
  async recordUsage(
    userId: string,
    kind: AiCallKind,
    tokens: { input?: number; output?: number } = {},
  ): Promise<void> {
    const day = this.today();
    const input = tokens.input ?? 0;
    const output = tokens.output ?? 0;

    try {
      await this.db
        .insert(schema.aiUsage)
        .values({
          userId,
          day,
          tipsCalls: kind === 'tips' ? 1 : 0,
          chatCalls: kind === 'chat' ? 1 : 0,
          inputTokens: input,
          outputTokens: output,
        })
        .onConflictDoUpdate({
          target: [schema.aiUsage.userId, schema.aiUsage.day],
          set: {
            tipsCalls: sql`${schema.aiUsage.tipsCalls} + ${kind === 'tips' ? 1 : 0}`,
            chatCalls: sql`${schema.aiUsage.chatCalls} + ${kind === 'chat' ? 1 : 0}`,
            inputTokens: sql`${schema.aiUsage.inputTokens} + ${input}`,
            outputTokens: sql`${schema.aiUsage.outputTokens} + ${output}`,
          },
        });
    } catch {
      // Metering must never take down the feature it meters. Losing a row
      // costs us accuracy in the ledger, not the user's request.
    }
  }

  /** Upsert from the RevenueCat webhook. The only writer of paid state. */
  async applyEntitlement(input: {
    userId: string;
    tier: Tier;
    source?: string | null;
    productId?: string | null;
    expiresAt?: Date | null;
    isLifetime?: boolean;
    rcAppUserId?: string | null;
  }): Promise<void> {
    const values = {
      userId: input.userId,
      tier: input.tier,
      source: input.source ?? null,
      productId: input.productId ?? null,
      expiresAt: input.expiresAt ?? null,
      isLifetime: input.isLifetime ?? false,
      rcAppUserId: input.rcAppUserId ?? null,
      updatedAt: new Date(),
    };

    await this.db
      .insert(schema.entitlements)
      .values(values)
      .onConflictDoUpdate({
        target: schema.entitlements.userId,
        set: {
          tier: values.tier,
          source: values.source,
          productId: values.productId,
          expiresAt: values.expiresAt,
          isLifetime: values.isLifetime,
          rcAppUserId: values.rcAppUserId,
          updatedAt: values.updatedAt,
        },
      });
  }
}
