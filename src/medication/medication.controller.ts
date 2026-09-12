import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  Delete,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { MedicationService } from './medication.service';
import {
  CreateMedicationDto,
  MEDICATION_STATUSES,
  MedicationStatus,
} from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { CreateFullMedicationDto } from './dto/create-full-medication.dto';
import { RestartMedicationDto } from './dto/restart-medication.dto';
import { SetRemindersDto } from './dto/set-reminders.dto';
import { CheckWarningsDto } from './dto/check-warnings.dto';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('medication')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('medication')
export class MedicationController {
  constructor(private readonly medicationService: MedicationService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new medication treatment' })
  create(@Request() req, @Body() createMedicationDto: CreateMedicationDto) {
    return this.medicationService.create(req.user.id, createMedicationDto);
  }

  @Post('full')
  @ApiOperation({
    summary:
      'Atomically create a medication with its dosage forms, schedules, and dose events',
  })
  createFull(@Request() req, @Body() dto: CreateFullMedicationDto) {
    return this.medicationService.createFull(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all medications for the current user' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: MEDICATION_STATUSES,
    description: 'Filter by lifecycle status. Omit to return all medications.',
  })
  findAll(@Request() req, @Query('status') status?: string) {
    // Query strings aren't bound to a DTO, so the ValidationPipe doesn't see
    // them — validate explicitly rather than passing an arbitrary string to SQL.
    if (
      status !== undefined &&
      !MEDICATION_STATUSES.includes(status as never)
    ) {
      throw new BadRequestException(
        `status must be one of: ${MEDICATION_STATUSES.join(', ')}`,
      );
    }
    return this.medicationService.findAllByUser(
      req.user.id,
      status as MedicationStatus | undefined,
    );
  }

  @Post('check-warnings')
  @ApiOperation({
    summary:
      'Advisory checks for a medication name: recorded allergies and duplicate therapy',
  })
  checkWarnings(@Request() req, @Body() dto: CheckWarningsDto) {
    return this.medicationService
      .checkWarnings(req.user.id, dto.names, dto.excludeMedicationId)
      .then((warnings) => ({ warnings }));
  }

  // Before any @Get(':id') route — see the dosage-form controller for the
  // same ordering constraint.
  @Get('reminder-state')
  @ApiOperation({
    summary: 'Map of medication id -> whether its reminders are on',
  })
  reminderState(@Request() req) {
    return this.medicationService.reminderState(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific medication by id' })
  findOne(@Request() req, @Param('id') id: string) {
    return this.medicationService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a specific medication' })
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateMedicationDto: UpdateMedicationDto,
  ) {
    return this.medicationService.update(id, req.user.id, updateMedicationDto);
  }

  @Patch(':id/complete')
  @ApiOperation({
    summary:
      'Stop taking a medication: ends reminders and clears upcoming doses',
    description:
      'Works for continuous medications too, which have no end date to expire. ' +
      'Dose history is preserved. Idempotent.',
  })
  complete(@Request() req, @Param('id') id: string) {
    return this.medicationService.complete(id, req.user.id);
  }

  @Patch(':id/reminders')
  @ApiOperation({
    summary: 'Turn reminders on/off for every schedule under a medication',
  })
  setReminders(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: SetRemindersDto,
  ) {
    return this.medicationService.setReminders(id, req.user.id, dto.enabled);
  }

  @Patch(':id/restart')
  @ApiOperation({
    summary: 'Reactivate a completed medication and regenerate its dose events',
    description:
      'A treatment course whose end date has passed requires a new future endDate, ' +
      'since an expired course cannot generate any doses.',
  })
  restart(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: RestartMedicationDto,
  ) {
    return this.medicationService.restart(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Delete a medication and cascade its related dosage forms, schedules, and events',
  })
  remove(@Request() req, @Param('id') id: string) {
    return this.medicationService.remove(id, req.user.id);
  }
}
