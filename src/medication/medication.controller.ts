import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { MedicationService } from './medication.service';
import { CreateMedicationDto } from './dto/create-medication.dto';
import { UpdateMedicationDto } from './dto/update-medication.dto';
import { CreateFullMedicationDto } from './dto/create-full-medication.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
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
  findAll(@Request() req) {
    return this.medicationService.findAllByUser(req.user.id);
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

  @Delete(':id')
  @ApiOperation({
    summary:
      'Delete a medication and cascade its related dosage forms, schedules, and events',
  })
  remove(@Request() req, @Param('id') id: string) {
    return this.medicationService.remove(id, req.user.id);
  }
}
