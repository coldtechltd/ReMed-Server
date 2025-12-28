import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { profiles } from '../db/schema';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfileService {
  constructor(@Inject('DRIZZLE_CLIENT') private db: any) {}

  async createProfile(userId: string, dto: CreateProfileDto) {
    const [existing] = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId));

    if (existing) {
      throw new BadRequestException('Profile already exists for this user');
    }

    const [newProfile] = await this.db
      .insert(profiles)
      .values({
        userId,
        ...dto,
      })
      .returning();

    return newProfile;
  }

  async getProfile(userId: string) {
    const [profile] = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId));

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return profile;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const [existing] = await this.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId));

    if (!existing) {
      throw new NotFoundException('Profile not found');
    }

    const [updatedProfile] = await this.db
      .update(profiles)
      .set(dto)
      .where(eq(profiles.userId, userId))
      .returning();

    return updatedProfile;
  }
}
