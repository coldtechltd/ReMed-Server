import { Module, Global } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DRIZZLE_CLIENT = 'DRIZZLE_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: 'DRIZZLE_CLIENT',
      useFactory: () => {
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
        });

        pool.on('error', (err, client) => {
          console.error('Unexpected error on idle client', err);
        });

        return drizzle(pool, { schema });
      },
    },
  ],
  exports: ['DRIZZLE_CLIENT'],
})
export class DrizzleModule {}
