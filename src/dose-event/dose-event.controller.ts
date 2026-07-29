import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { DoseEventService } from './dose-event.service';
import { UpdateDoseEventDto } from './dto/update-dose-event.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('dose-event')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dose-event')
export class DoseEventController {
  constructor(private readonly doseEventService: DoseEventService) {}

  @Get()
  @ApiOperation({ summary: 'Get all dose events for the current user' })
  findAll(@Request() req) {
    return this.doseEventService.findAllByUser(req.user.id);
  }

  @Get('upcoming')
  @ApiOperation({
    summary:
      'Get upcoming pending dose events, optionally bounded to a window (from/days/limit)',
  })
  getUpcoming(
    @Request() req,
    @Query('from') from?: string,
    @Query('days', new ParseIntPipe({ optional: true })) days?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('tz') tz?: string,
  ) {
    return this.doseEventService.getUpcoming(req.user.id, {
      from,
      days,
      limit,
      tz,
    });
  }

  @Get('by-date')
  @ApiOperation({
    summary:
      'Get dose events for a specific date (optionally interpreted in an IANA timezone)',
  })
  findEventsByDate(
    @Request() req,
    @Query('date') date: string,
    @Query('tz') tz?: string,
  ) {
    return this.doseEventService.findEventsByDate(req.user.id, date, tz);
  }

  @Get('stats')
  @ApiOperation({
    summary:
      'Adherence stats for the current user (rate, streaks, per-day and per-medication breakdown)',
  })
  getStats(
    @Request() req,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.doseEventService.getStats(req.user.id, from, to);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific dose event by id' })
  findOne(@Request() req, @Param('id') id: string) {
    return this.doseEventService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a specific dose event (e.g. mark as taken/missed)',
  })
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateDto: UpdateDoseEventDto,
  ) {
    return this.doseEventService.update(id, req.user.id, updateDto);
  }
}
