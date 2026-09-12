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
import { RedeemCodeDto } from './dto/redeem-code.dto';
import { UpdateCompanionLinkDto } from './dto/update-companion-link.dto';
import { MedicationService } from '../medication/medication.service';
import { DosageFormService } from '../dosage-form/dosage-form.service';
import { DoseEventService } from '../dose-event/dose-event.service';
import type { MedicationStatus } from '../medication/dto/create-medication.dto';

/**
 * Companion sharing: read-only access for a second person who redeemed the
 * owner's sharing code.
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

  @Get('code')
  @ApiOperation({
    summary:
      'My companion code — the one I share so someone can watch my doses. Created on first read and stable until rotated. Also reports how many companion seats my plan allows.',
  })
  myCode(@Request() req) {
    return this.companionService.getMyCode(req.user.id);
  }

  // Rotation invalidates a code other people may be holding, so it is not a
  // button anyone should be able to hammer — and a runaway client loop would
  // otherwise churn the owner's code faster than they could share it.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('code/rotate')
  @ApiOperation({
    summary:
      'Replace my companion code. Existing companions keep their access; only future joins are affected.',
  })
  rotate(@Request() req) {
    return this.companionService.rotateCode(req.user.id);
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
  @ApiOperation({ summary: "Remove a companion's access" })
  revokeInvite(@Request() req, @Param('id') id: string) {
    return this.companionService.revoke(req.user.id, id);
  }

  // ------------------------------------------------------------ companion side

  // Tighter than the global 100/min: this is the only route that takes a guess
  // at a secret, so it is the one brute-force surface the feature adds. At 5/min
  // the 32^8 keyspace needs ~400,000 years to sweep.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('redeem')
  @ApiOperation({ summary: "Redeem someone's companion code" })
  redeem(@Request() req, @Body() dto: RedeemCodeDto) {
    return this.companionService.redeemCode(req.user.id, dto.code);
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

  // ------------------------------------------------------------- compatibility
  //
  // Already-shipped clients call these two. They are kept so an app build from
  // before persistent codes keeps working rather than dead-ending on a 404:
  // `invites` hands back the durable code where it used to mint a single-use
  // one, and `accept` is just the new redeem route under its old name. Both
  // can go once the old builds are out of circulation.

  @Post('invites')
  @ApiOperation({ deprecated: true, summary: 'Use GET /companion/code.' })
  createInvite(
    @Request() req,
    // The body is ignored, but it still has to be declared: without @Body the
    // global whitelist never inspects it, and old clients post `{ label }`.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() _dto: CreateInviteDto,
  ) {
    return this.companionService.getMyCode(req.user.id);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('accept')
  @ApiOperation({ deprecated: true, summary: 'Use POST /companion/redeem.' })
  acceptInvite(@Request() req, @Body() dto: RedeemCodeDto) {
    return this.companionService.redeemCode(req.user.id, dto.code);
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
