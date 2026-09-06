import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { EntitlementService } from '../billing/entitlement.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { UpdateCompanionLinkDto } from './dto/update-companion-link.dto';
import {
  generateInviteCode,
  hashInviteCode,
  inviteExpiryFrom,
} from './invite-code.util';

export type CompanionLink = typeof schema.companionLinks.$inferSelect;

@Injectable()
export class CompanionService {
  private readonly logger = new Logger(CompanionService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly entitlements: EntitlementService,
    private readonly config: ConfigService,
  ) {}

  /** Base for the shareable https link that deep-links into the app. */
  private joinUrl(code: string): string {
    const base =
      this.config.get<string>('PUBLIC_API_URL') ??
      this.config.get<string>('FRONTEND_URL')?.split(',')[0]?.trim() ??
      '';
    return `${base.replace(/\/$/, '')}/join/${code}`;
  }

  /**
   * Creates a pending invite. The plaintext code is returned exactly once —
   * only its hash is stored, so it cannot be re-read later (the owner revokes
   * and re-invites instead).
   */
  async createInvite(ownerId: string, dto: CreateInviteDto) {
    await this.entitlements.assertCompanionLimit(ownerId);

    const code = generateInviteCode();
    const expiresAt = inviteExpiryFrom();

    const [link] = await this.db
      .insert(schema.companionLinks)
      .values({
        ownerId,
        label: dto.label ?? null,
        inviteCodeHash: hashInviteCode(code),
        expiresAt,
      })
      .returning();

    return { ...link, code, url: this.joinUrl(code) };
  }

  /**
   * Redeems a code. Deliberately vague on failure: a valid-but-expired code and
   * a code that never existed return the same message, so this route can't be
   * used to probe which codes are real.
   */
  async acceptInvite(companionId: string, rawCode: string) {
    const [link] = await this.db
      .select()
      .from(schema.companionLinks)
      .where(
        and(
          eq(schema.companionLinks.inviteCodeHash, hashInviteCode(rawCode)),
          eq(schema.companionLinks.status, 'pending'),
        ),
      )
      .limit(1);

    if (!link || link.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('That invite code is not valid any more.');
    }

    if (link.ownerId === companionId) {
      throw new BadRequestException('You cannot accept your own invite.');
    }

    // Re-accepting from a second device, or a fresh invite from someone who
    // already shares with you, should be a no-op rather than tripping the
    // partial unique index.
    const [existing] = await this.db
      .select()
      .from(schema.companionLinks)
      .where(
        and(
          eq(schema.companionLinks.ownerId, link.ownerId),
          eq(schema.companionLinks.companionId, companionId),
          eq(schema.companionLinks.status, 'active'),
        ),
      )
      .limit(1);

    if (existing) {
      // Retire the now-redundant invite so it stops occupying a seat.
      await this.db
        .update(schema.companionLinks)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
          revokedBy: companionId,
          inviteCodeHash: null,
        })
        .where(eq(schema.companionLinks.id, link.id));
      return existing;
    }

    const [accepted] = await this.db
      .update(schema.companionLinks)
      .set({
        companionId,
        status: 'active',
        acceptedAt: new Date(),
        // Single use: the code stops working the moment it is redeemed.
        inviteCodeHash: null,
      })
      .where(
        and(
          eq(schema.companionLinks.id, link.id),
          // Guards against two devices racing the same code.
          eq(schema.companionLinks.status, 'pending'),
        ),
      )
      .returning();

    if (!accepted) {
      throw new BadRequestException('That invite code is not valid any more.');
    }

    this.logger.log(
      `Companion link accepted: owner=${link.ownerId} companion=${companionId}`,
    );
    return accepted;
  }

  /** The owner's management list: who they share with, plus unredeemed invites. */
  async listOutgoing(ownerId: string) {
    const rows = await this.db
      .select({
        link: schema.companionLinks,
        companionName: schema.profiles.fullName,
        companionEmail: schema.users.email,
      })
      .from(schema.companionLinks)
      .leftJoin(
        schema.users,
        eq(schema.companionLinks.companionId, schema.users.id),
      )
      .leftJoin(
        schema.profiles,
        eq(schema.companionLinks.companionId, schema.profiles.userId),
      )
      .where(
        and(
          eq(schema.companionLinks.ownerId, ownerId),
          inArray(schema.companionLinks.status, ['pending', 'active']),
        ),
      )
      .orderBy(desc(schema.companionLinks.invitedAt));

    return rows.map(({ link, companionName, companionEmail }) => ({
      id: link.id,
      status: link.status,
      role: link.role,
      // A companion who never created a profile has no fullName — that is the
      // normal case, since companions skip profile creation entirely.
      label: link.label ?? companionName ?? companionEmail ?? 'Companion',
      notifyMissedDose: link.notifyMissedDose,
      notifyRefill: link.notifyRefill,
      invitedAt: link.invitedAt,
      expiresAt: link.expiresAt,
      acceptedAt: link.acceptedAt,
      lastViewedAt: link.lastViewedAt,
    }));
  }

  /** The companion's list: whose medications they may read. */
  async listFollowing(companionId: string) {
    const rows = await this.db
      .select({
        link: schema.companionLinks,
        ownerName: schema.profiles.fullName,
        ownerEmail: schema.users.email,
      })
      .from(schema.companionLinks)
      .innerJoin(
        schema.users,
        eq(schema.companionLinks.ownerId, schema.users.id),
      )
      .leftJoin(
        schema.profiles,
        eq(schema.companionLinks.ownerId, schema.profiles.userId),
      )
      .where(
        and(
          eq(schema.companionLinks.companionId, companionId),
          eq(schema.companionLinks.status, 'active'),
        ),
      )
      .orderBy(desc(schema.companionLinks.acceptedAt));

    return rows.map(({ link, ownerName, ownerEmail }) => ({
      linkId: link.id,
      ownerId: link.ownerId,
      // Owners always have a profile (the tabs are gated on it), so fullName is
      // effectively always present; email is a defensive fallback only.
      displayName: ownerName ?? ownerEmail,
      role: link.role,
      since: link.acceptedAt,
    }));
  }

  async updateLink(
    ownerId: string,
    id: string,
    dto: UpdateCompanionLinkDto,
  ): Promise<CompanionLink> {
    const [updated] = await this.db
      .update(schema.companionLinks)
      .set({
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.notifyMissedDose !== undefined
          ? { notifyMissedDose: dto.notifyMissedDose }
          : {}),
        ...(dto.notifyRefill !== undefined
          ? { notifyRefill: dto.notifyRefill }
          : {}),
      })
      .where(
        and(
          eq(schema.companionLinks.id, id),
          eq(schema.companionLinks.ownerId, ownerId),
          inArray(schema.companionLinks.status, ['pending', 'active']),
        ),
      )
      .returning();

    if (!updated) throw new NotFoundException('Companion link not found');
    return updated;
  }

  /**
   * Revoke by link id. Either side may do it — the owner withdrawing access and
   * the companion stepping away are the same operation.
   */
  async revoke(userId: string, id: string) {
    const [revoked] = await this.db
      .update(schema.companionLinks)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
        revokedBy: userId,
        inviteCodeHash: null,
      })
      .where(
        and(
          eq(schema.companionLinks.id, id),
          or(
            eq(schema.companionLinks.ownerId, userId),
            eq(schema.companionLinks.companionId, userId),
          ),
          inArray(schema.companionLinks.status, ['pending', 'active']),
        ),
      )
      .returning();

    if (!revoked) throw new NotFoundException('Companion link not found');
    return { success: true };
  }

  /** Companion-initiated revoke addressed by owner rather than link id. */
  async stopFollowing(companionId: string, ownerId: string) {
    const [revoked] = await this.db
      .update(schema.companionLinks)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
        revokedBy: companionId,
      })
      .where(
        and(
          eq(schema.companionLinks.companionId, companionId),
          eq(schema.companionLinks.ownerId, ownerId),
          eq(schema.companionLinks.status, 'active'),
        ),
      )
      .returning();

    if (!revoked) throw new NotFoundException('Companion link not found');
    return { success: true };
  }

  /**
   * The authorization check behind every companion read.
   *
   * Throws 404, not 403: a 403 would confirm that a given user id exists and
   * has data, turning this into an enumeration oracle. This matches
   * MedicationService.findOne rather than ScheduleService.findOne.
   */
  async assertAccess(
    companionId: string,
    ownerId: string,
  ): Promise<CompanionLink> {
    const [link] = await this.db
      .select()
      .from(schema.companionLinks)
      .where(
        and(
          eq(schema.companionLinks.companionId, companionId),
          eq(schema.companionLinks.ownerId, ownerId),
          eq(schema.companionLinks.status, 'active'),
        ),
      )
      .limit(1);

    if (!link) throw new NotFoundException('Not found');

    // Fire-and-forget: "last viewed" is a nicety for the owner's screen and
    // must never fail or slow down the read it decorates.
    void this.db
      .update(schema.companionLinks)
      .set({ lastViewedAt: new Date() })
      .where(eq(schema.companionLinks.id, link.id))
      .catch((e) => this.logger.warn(`lastViewedAt update failed: ${e}`));

    return link;
  }

  /** Active companions for an owner, for the notification fan-out. */
  async recipientsFor(
    ownerIds: string[],
    channel: 'notifyMissedDose' | 'notifyRefill',
  ) {
    if (ownerIds.length === 0) return [];
    return this.db
      .select({
        ownerId: schema.companionLinks.ownerId,
        companionId: schema.companionLinks.companionId,
      })
      .from(schema.companionLinks)
      .where(
        and(
          inArray(schema.companionLinks.ownerId, ownerIds),
          eq(schema.companionLinks.status, 'active'),
          eq(schema.companionLinks[channel], true),
        ),
      );
  }
}
