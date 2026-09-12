import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';
import { EntitlementService } from '../billing/entitlement.service';
import { UpdateCompanionLinkDto } from './dto/update-companion-link.dto';
import {
  generateCompanionCode,
  normalizeCompanionCode,
} from './companion-code.util';

export type CompanionLink = typeof schema.companionLinks.$inferSelect;

/** What the owner's sharing screen needs to render the code and the seat count. */
export interface CompanionCodeView {
  code: string;
  /** Shareable https link that deep-links the code into the app. */
  url: string;
  createdAt: Date;
  rotatedAt: Date | null;
  tier: string;
  /** Companion seats this tier allows. */
  limit: number;
  /** Seats currently taken by an active companion. */
  used: number;
}

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

  private async view(
    ownerId: string,
    row: typeof schema.companionCodes.$inferSelect,
  ): Promise<CompanionCodeView> {
    const seats = await this.entitlements.companionSeats(ownerId);
    return {
      code: row.code,
      url: this.joinUrl(row.code),
      createdAt: row.createdAt,
      rotatedAt: row.rotatedAt,
      ...seats,
    };
  }

  /**
   * Inserts a fresh code for a user, retrying on the astronomically unlikely
   * unique-index collision rather than surfacing it as a 500.
   *
   * `onConflictDoUpdate` on the primary key makes this double as rotation: the
   * row is per user, so re-issuing is an update in the same statement — and
   * `rotatedAt` lands only on that conflict branch, which is exactly when a
   * code really was replaced rather than minted.
   */
  private async issueCode(
    ownerId: string,
  ): Promise<typeof schema.companionCodes.$inferSelect> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCompanionCode();
      try {
        const [row] = await this.db
          .insert(schema.companionCodes)
          .values({ userId: ownerId, code })
          .onConflictDoUpdate({
            target: schema.companionCodes.userId,
            set: { code, rotatedAt: new Date() },
          })
          .returning();
        return row;
      } catch (e) {
        // 23505 is unique_violation, which here can only be the code index —
        // the userId conflict is handled above. Anything else is a real fault.
        if ((e as { code?: string }).code !== '23505') throw e;
        this.logger.warn(
          `Companion code collision on attempt ${attempt + 1}, retrying`,
        );
      }
    }
    throw new InternalServerErrorException(
      'Could not allocate a companion code. Please try again.',
    );
  }

  /**
   * The owner's durable sharing code, created on first read.
   *
   * Lazy creation on purpose: most users never share, and a code that exists
   * for someone who has never opened the screen is a credential with no owner
   * watching it.
   */
  async getMyCode(ownerId: string): Promise<CompanionCodeView> {
    const [existing] = await this.db
      .select()
      .from(schema.companionCodes)
      .where(eq(schema.companionCodes.userId, ownerId))
      .limit(1);

    if (existing) return this.view(ownerId, existing);
    return this.view(ownerId, await this.issueCode(ownerId));
  }

  /**
   * Issues a new code and retires the old one. Existing companions keep their
   * access — rotation governs who may join from here on, not who already has.
   * Revoking someone is a separate, deliberate action.
   */
  async rotateCode(ownerId: string): Promise<CompanionCodeView> {
    const row = await this.issueCode(ownerId);
    this.logger.log(`Companion code rotated: owner=${ownerId}`);
    return this.view(ownerId, row);
  }

  /**
   * Redeems an owner's code into an active link.
   *
   * Deliberately vague on failure: an unknown code and a code belonging to
   * someone who has since rotated return the same message, so this route
   * cannot be used to probe which codes are real.
   */
  async redeemCode(companionId: string, rawCode: string) {
    const normalized = normalizeCompanionCode(rawCode);

    const [owner] = await this.db
      .select({ ownerId: schema.companionCodes.userId })
      .from(schema.companionCodes)
      .where(eq(schema.companionCodes.code, normalized))
      .limit(1);

    if (!owner) {
      throw new BadRequestException('That code is not valid.');
    }

    if (owner.ownerId === companionId) {
      throw new BadRequestException('That is your own code.');
    }

    // Re-entering a code you have already redeemed — from a second device, or
    // because the owner sent it again — is a no-op rather than an error or a
    // duplicate row.
    const [existing] = await this.db
      .select()
      .from(schema.companionLinks)
      .where(
        and(
          eq(schema.companionLinks.ownerId, owner.ownerId),
          eq(schema.companionLinks.companionId, companionId),
          eq(schema.companionLinks.status, 'active'),
        ),
      )
      .limit(1);

    if (existing) return existing;

    // Seats belong to the owner, but it is the joiner who is standing here, so
    // the message is written for them (see assertCompanionLimit).
    await this.entitlements.assertCompanionLimit(owner.ownerId, 'joiner');

    const now = new Date();
    const [link] = await this.db
      .insert(schema.companionLinks)
      .values({
        ownerId: owner.ownerId,
        companionId,
        status: 'active',
        invitedAt: now,
        acceptedAt: now,
      })
      .returning();

    this.logger.log(
      `Companion link created: owner=${owner.ownerId} companion=${companionId}`,
    );
    return link;
  }

  /** The owner's management list: the people who can currently see their doses. */
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
          eq(schema.companionLinks.status, 'active'),
        ),
      )
      .orderBy(desc(schema.companionLinks.acceptedAt));

    return rows.map(({ link, companionName, companionEmail }) => ({
      id: link.id,
      status: link.status,
      role: link.role,
      // A companion who never created a profile has no fullName — that is the
      // normal case, since companions skip profile creation entirely.
      label: link.label ?? companionName ?? companionEmail ?? 'Companion',
      // Kept so the owner can tell a name they typed from one the profile
      // supplied, and prefill the rename field with the former.
      customLabel: link.label,
      notifyMissedDose: link.notifyMissedDose,
      notifyRefill: link.notifyRefill,
      invitedAt: link.invitedAt,
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
          eq(schema.companionLinks.status, 'active'),
        ),
      )
      .returning();

    if (!updated) throw new NotFoundException('Companion link not found');
    return updated;
  }

  /**
   * Revoke by link id. Either side may do it — the owner withdrawing access and
   * the companion stepping away are the same operation.
   *
   * Revoking does not touch the owner's sharing code: the removed companion
   * could redeem it again if they still have it, which is why `rotateCode`
   * exists and why the app offers it alongside a removal.
   */
  async revoke(userId: string, id: string) {
    const [revoked] = await this.db
      .update(schema.companionLinks)
      .set({
        status: 'revoked',
        revokedAt: new Date(),
        revokedBy: userId,
      })
      .where(
        and(
          eq(schema.companionLinks.id, id),
          or(
            eq(schema.companionLinks.ownerId, userId),
            eq(schema.companionLinks.companionId, userId),
          ),
          eq(schema.companionLinks.status, 'active'),
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
