import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { conditions } from '../db/schema';

@Injectable()
export class ConditionService {
  constructor(@Inject('DRIZZLE_CLIENT') private db: any) {}

  async findAll(): Promise<string[]> {
    const rows = await this.db
      .select({ name: conditions.name })
      .from(conditions)
      .orderBy(conditions.name);
    return rows.map((r: { name: string }) => r.name);
  }

  async upsert(name: string): Promise<void> {
    await this.db
      .insert(conditions)
      .values({ name })
      .onConflictDoNothing({ target: conditions.name });
  }
}
