import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ProfileService } from './profile.service';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post()
  @ApiOperation({ summary: 'Create user profile' })
  create(@Request() req, @Body() createProfileDto: CreateProfileDto) {
    return this.profileService.createProfile(req.user.id, createProfileDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get user profile' })
  get(@Request() req) {
    return this.profileService.getProfile(req.user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Update user profile' })
  update(@Request() req, @Body() updateProfileDto: UpdateProfileDto) {
    return this.profileService.updateProfile(req.user.id, updateProfileDto);
  }
}
