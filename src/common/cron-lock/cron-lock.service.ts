import { Inject, Injectable, Logger } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { lt } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { DRIZZLE_CLIENT } from '../../db/drizzle.module';

/**
 * Claim-based dedup for @nestjs/schedule crons, which run in-process on every
 * instance. Before doing any work, a cron calls claim(name, periodMs); only
 * the instance whose INSERT lands for the current period bucket proceeds.
 * ON CONFLICT DO NOTHING makes the race harmless through any connection pool
 * (session advisory locks are not safe over pooled connections).
 */
@Injectable()
export class CronLockService {
  private readonly logger = new Logger(CronLockService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Returns true when this instance won the claim for the current period.
   * All replicas compute the same bucket (floor of epoch time / period), so
   * exactly one insert succeeds per period regardless of clock-tick jitter.
   *
   * Throws on DB errors — callers already wrap cron bodies in try/catch with
   * transient-error handling, and "couldn't claim" must not be silently
   * treated as "someone else ran it".
   */
  async claim(name: string, periodMs: number): Promise<boolean> {
    const periodStart = new Date(
      Math.floor(Date.now() / periodMs) * periodMs,
    );

    const inserted = await this.db
      .insert(schema.cronLocks)
      .values({ name, periodStart })
      .onConflictDoNothing()
      .returning({ name: schema.cronLocks.name });

    const won = inserted.length > 0;
    if (won) {
      // Opportunistic cleanup so the table never grows unbounded. Best-effort:
      // a failure here must not cancel the run we just claimed.
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      this.db
        .delete(schema.cronLocks)
        .where(lt(schema.cronLocks.periodStart, cutoff))
        .catch((e: unknown) =>
          this.logger.warn(`cron_locks cleanup failed: ${e}`),
        );
    }
    return won;
  }
}
