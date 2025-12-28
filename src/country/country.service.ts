import { Injectable, Inject } from '@nestjs/common';
import { countries } from '../db/schema';

@Injectable()
export class CountryService {
  constructor(@Inject('DRIZZLE_CLIENT') private db: any) {}

  async getCountries() {
    return await this.db.select().from(countries);
  }
}
