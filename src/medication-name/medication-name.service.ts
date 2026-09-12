import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { asc, ilike, or, sql } from 'drizzle-orm';
import * as schema from '../db/schema';
import { DRIZZLE_CLIENT } from '../db/drizzle.module';

const MAX_RESULTS = 20;
const MIN_QUERY_LENGTH = 2;

@Injectable()
export class MedicationNameService {
  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Prefix matches first, then anywhere-in-the-name.
   *
   * The ordering matters more than it looks: typing "para" should surface
   * "Paracetamol" above "Atovaquone/Proguanil", and a plain ILIKE '%q%' sorted
   * alphabetically does the opposite. Brand names match too, so someone who
   * knows the box says "Panadol" isn't forced to know the generic.
   */
  async search(query?: string, limit = MAX_RESULTS) {
    const q = query?.trim() ?? '';
    const take = Math.min(Math.max(limit, 1), MAX_RESULTS);

    if (q.length < MIN_QUERY_LENGTH) return [];

    const escaped = q.replace(/[%_\\]/g, (c) => `\\${c}`);

    return this.db
      .select({
        name: schema.medicationNames.name,
        genericName: schema.medicationNames.genericName,
      })
      .from(schema.medicationNames)
      .where(
        or(
          ilike(schema.medicationNames.name, `${escaped}%`),
          ilike(schema.medicationNames.name, `%${escaped}%`),
          ilike(schema.medicationNames.genericName, `${escaped}%`),
        ),
      )
      .orderBy(
        // Prefix hits rank 0, everything else rank 1.
        sql`CASE WHEN ${schema.medicationNames.name} ILIKE ${escaped + '%'} THEN 0 ELSE 1 END`,
        asc(schema.medicationNames.name),
      )
      .limit(take);
  }

  /**
   * The active ingredient for a typed name, or null when it isn't one we know.
   *
   * Used by duplicate-therapy detection so "Panadol" and "Paracetamol" resolve
   * to the same thing. A miss is normal and must not be treated as an error —
   * the curated list is a convenience, not a formulary.
   */
  async resolveGeneric(name: string): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const [row] = await this.db
      .select({ genericName: schema.medicationNames.genericName })
      .from(schema.medicationNames)
      .where(ilike(schema.medicationNames.name, trimmed))
      .limit(1);

    return row?.genericName ?? null;
  }
}
