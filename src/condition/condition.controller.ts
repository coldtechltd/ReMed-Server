import { Controller, Get } from '@nestjs/common';
import { ConditionService } from './condition.service';

@Controller('conditions')
export class ConditionController {
  constructor(private readonly conditionService: ConditionService) {}

  @Get()
  findAll(): Promise<string[]> {
    return this.conditionService.findAll();
  }
}
