import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MedicationNameService } from './medication-name.service';

@ApiTags('medication-name')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('medication-name')
export class MedicationNameController {
  constructor(private readonly service: MedicationNameService) {}

  @Get()
  @ApiOperation({
    summary: 'Autocomplete medication names (generic and brand)',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Search term, min 2 chars',
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Max 20' })
  search(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.service.search(q, limit ? Number(limit) : undefined);
  }
}
