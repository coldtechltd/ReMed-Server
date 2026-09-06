import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanionService } from './companion.service';
import { CompanionAccessGuard } from './guards/companion-access.guard';
import { CreateInviteDto } from './dto/create-invite.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { UpdateCompanionLinkDto } from './dto/update-companion-link.dto';
import { MedicationService } from '../medication/medication.service';
import { DosageFormService } from '../dosage-form/dosage-form.service';
import { DoseEventService } from '../dose-event/dose-event.service';
import type { MedicationStatus } from '../medication/dto/create-medication.dto';

/**
 * Companion sharing: read-only access for an invited second person.
 *
 * The read routes live here rather than as a flag on the owner's endpoints so
 * that `req.user.id` keeps meaning "the tenant" everywhere else in the app — a
 * mistake in this file cannot widen /medication or /dose-event.
 *
 * Every read passes `excludePrivate: true`, and reuses the owner-side service
 * methods so timezone handling, the notStoppedBefore filter and the response
 * shape can't drift from what the owner sees.
 */
@ApiTags('companion')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('companion')
export class CompanionController {
  constructor(
    private readonly companionService: CompanionService,
    private readonly medicationService: MedicationService,
    private readonly dosageFormService: DosageFormService,
    private readonly doseEventService: DoseEventService,
  ) {}

  // ---------------------------------------------------------------- owner side

  @Post('invites')
  @ApiOperation({
    summary:
      'Create an invite. The plaintext code is returned once and never again.',
  })
  createInvite(@Request() req, @Body() dto: CreateInviteDto) {
    return this.companionService.createInvite(req.user.id, dto);
  }

  @Get('invites')
  @ApiOperation({ summary: 'List the people I share my medications with' })
  listInvites(@Request() req) {
    return this.companionService.listOutgoing(req.user.id);
  }

  @Patch('invites/:id')
  @ApiOperation({
    summary: 'Rename a companion or change their alert settings',
  })
  updateInvite(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateCompanionLinkDto,
  ) {
    return this.companionService.updateLink(req.user.id, id, dto);
  }

  @Delete('invites/:id')
  @ApiOperation({ summary: 'Revoke an invite or an active companion link' })
  revokeInvite(@Request() req, @Param('id') id: string) {
    return this.companionService.revoke(req.user.id, id);
  }

  // ------------------------------------------------------------ companion side

  // Tighter than the global 100/min: this is the only route that takes a guess
  // at a secret, so it is the one brute-force surface the feature adds.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('accept')
  @ApiOperation({ summary: 'Redeem an invite code' })
  acceptInvite(@Request() req, @Body() dto: AcceptInviteDto) {
    return this.companionService.acceptInvite(req.user.id, dto.code);
  }

  @Get('following')
  @ApiOperation({ summary: 'List the people whose medications I can see' })
  listFollowing(@Request() req) {
    return this.companionService.listFollowing(req.user.id);
  }

  @Delete('following/:ownerId')
  @ApiOperation({ summary: 'Stop following someone (companion-initiated)' })
  stopFollowing(@Request() req, @Param('ownerId') ownerId: string) {
    return this.companionService.stopFollowing(req.user.id, ownerId);
  }

  // ----------------------------------------------------------- companion reads

  @UseGuards(CompanionAccessGuard)
  @Get(':ownerId/medication')
  @ApiOperation({ summary: "A shared owner's medications" })
  medications(
    @Param('ownerId') ownerId: string,
    @Query('status') status?: string,
  ) {
    return this.medicationService.findAllByUser(
      ownerId,
      status as MedicationStatus | undefined,
      { excludePrivate: true },
    );
  }

  @UseGuards(CompanionAccessGuard)
  @Get(':ownerId/dosage-form/medication/:medicationId')
  @ApiOperation({ summary: 'Dosage forms of one shared medication' })
  dosageForms(
    @Param('ownerId') ownerId: string,
    @Param('medicationId') medicationId: string,
  ) {
    return this.dosageFormService.findAllByMedication(medicationId, ownerId, {
      excludePrivate: true,
    });
  }

  @UseGuards(CompanionAccessGuard)
  @Get(':ownerId/dose-event/by-date')
  @ApiOperation({ summary: "A shared owner's doses for one calendar day" })
  dosesByDate(
    @Param('ownerId') ownerId: string,
    @Query('date') date: string,
    @Query('tz') tz?: string,
  ) {
    return this.doseEventService.findEventsByDate(ownerId, date, tz, {
      excludePrivate: true,
    });
  }

  @UseGuards(CompanionAccessGuard)
  @Get(':ownerId/dose-event/upcoming')
  @ApiOperation({ summary: "A shared owner's upcoming doses" })
  upcoming(
    @Param('ownerId') ownerId: string,
    @Query('from') from?: string,
    @Query('days', new ParseIntPipe({ optional: true })) days?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('tz') tz?: string,
  ) {
    return this.doseEventService.getUpcoming(ownerId, {
      from,
      days,
      limit,
      tz,
      excludePrivate: true,
    });
  }

  @UseGuards(CompanionAccessGuard)
  @Get(':ownerId/dose-event/stats')
  @ApiOperation({ summary: "A shared owner's adherence stats" })
  stats(
    @Param('ownerId') ownerId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('tz') tz?: string,
  ) {
    return this.doseEventService.getStats(ownerId, from, to, tz, {
      excludePrivate: true,
    });
  }
}
