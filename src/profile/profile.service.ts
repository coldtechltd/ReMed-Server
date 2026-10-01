import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ConditionService } from '../condition/condition.service';
import { profiles, countries } from '../db/schema';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateLocaleDto } from './dto/update-locale.dto';
import { canonicalLocale, isValidTimeZone } from './locale.util';

@Injectable()
export class ProfileService {
  constructor(
    @Inject('DRIZZLE_CLIENT') private db: any,
    private readonly conditionService: ConditionService,
  ) {}

  async createProfile(userId: string, dto: CreateProfileDto) {
    const [existing] = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId));

    if (existing) {
      throw new BadRequestException('Profile already exists for this user');
    }

    if (dto.diagnosedWith?.trim()) {
      await this.conditionService.upsert(dto.diagnosedWith.trim());
    }

    const [newProfile] = await this.db
      .insert(profiles)
      .values({ userId, ...dto })
      .returning();

    return newProfile;
  }

  async getProfile(userId: string) {
    const [row] = await this.db
      .select({ profile: profiles, countryName: countries.name })
      .from(profiles)
      .leftJoin(countries, eq(profiles.countryId, countries.id))
      .where(eq(profiles.userId, userId));

    if (!row) {
      throw new NotFoundException('Profile not found');
    }

    return { ...row.profile, countryName: row.countryName };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const [existing] = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId));

    if (!existing) {
      throw new NotFoundException('Profile not found');
    }

    if (dto.diagnosedWith?.trim()) {
      await this.conditionService.upsert(dto.diagnosedWith.trim());
    }

    const [updatedProfile] = await this.db
      .update(profiles)
      .set(dto)
      .where(eq(profiles.userId, userId))
      .returning();

    return updatedProfile;
  }

  /**
   * Record the zone and locale the phone reports (B12).
   *
   * Separate from updateProfile because the app calls it on its own, on
   * launch and foreground, and it must neither trip the profile form's
   * validation nor 404: someone who only cares for others has no profile, so
   * there is nothing to store and that is fine.
   */
  async updateLocale(userId: string, dto: UpdateLocaleDto) {
    if (!isValidTimeZone(dto.timezone)) {
      throw new BadRequestException(`Unknown timezone "${dto.timezone}"`);
    }
    const locale = dto.locale ? canonicalLocale(dto.locale) : null;
    if (dto.locale && !locale) {
      throw new BadRequestException(`Unknown locale "${dto.locale}"`);
    }

    const updated = await this.db
      .update(profiles)
      .set({ timezone: dto.timezone, ...(locale ? { locale } : {}) })
      .where(eq(profiles.userId, userId))
      .returning({ id: profiles.id });

    return { updated: updated.length > 0 };
  }
}
