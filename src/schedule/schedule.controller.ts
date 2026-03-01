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
import { ScheduleService } from './schedule.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new schedule for a dosage form' })
  create(@Request() req, @Body() createDto: CreateScheduleDto) {
    return this.scheduleService.create(req.user.id, createDto);
  }

  @Get('dosage-form/:dosageFormId')
  @ApiOperation({ summary: 'Get all schedules for a specific dosage form' })
  findAllByDosageForm(
    @Request() req,
    @Param('dosageFormId') dosageFormId: string,
  ) {
    return this.scheduleService.findAllByDosageForm(dosageFormId, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific schedule by id' })
  findOne(@Request() req, @Param('id') id: string) {
    return this.scheduleService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a specific schedule' })
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateDto: UpdateScheduleDto,
  ) {
    return this.scheduleService.update(id, req.user.id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a schedule and cascade its related dose events',
  })
  remove(@Request() req, @Param('id') id: string) {
    return this.scheduleService.remove(id, req.user.id);
  }
}
