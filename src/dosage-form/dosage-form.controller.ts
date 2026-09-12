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
  Query,
} from '@nestjs/common';
import { DosageFormService } from './dosage-form.service';
import { CreateDosageFormDto } from './dto/create-dosage-form.dto';
import { UpdateDosageFormDto } from './dto/update-dosage-form.dto';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('dosage-form')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dosage-form')
export class DosageFormController {
  constructor(private readonly dosageFormService: DosageFormService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new dosage form for a medication' })
  create(@Request() req, @Body() createDto: CreateDosageFormDto) {
    return this.dosageFormService.create(req.user.id, createDto);
  }

  @Get('medication/:medicationId')
  @ApiOperation({ summary: 'Get all dosage forms for a specific medication' })
  findAllByMedication(
    @Request() req,
    @Param('medicationId') medicationId: string,
  ) {
    return this.dosageFormService.findAllByMedication(
      medicationId,
      req.user.id,
    );
  }

  // Declared before @Get(':id') — Nest matches routes in declaration order,
  // so the param route would otherwise swallow "as-needed" as an id.
  @Get('as-needed')
  @ApiOperation({
    summary: "The user's as-needed (PRN) dosage forms with today's dose count",
  })
  @ApiQuery({ name: 'tz', required: false, description: 'IANA timezone' })
  findAsNeeded(@Request() req, @Query('tz') tz?: string) {
    return this.dosageFormService.findAsNeeded(req.user.id, tz);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific dosage form by id' })
  findOne(@Request() req, @Param('id') id: string) {
    return this.dosageFormService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a specific dosage form' })
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateDto: UpdateDosageFormDto,
  ) {
    return this.dosageFormService.update(id, req.user.id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Delete a dosage form and cascade its related schedules and events',
  })
  remove(@Request() req, @Param('id') id: string) {
    return this.dosageFormService.remove(id, req.user.id);
  }
}
