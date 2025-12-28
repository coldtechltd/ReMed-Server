import { Controller, Get } from '@nestjs/common';
import { CountryService } from './country.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('countries')
@Controller('countries')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get()
  @ApiOperation({ summary: 'Get all countries' })
  getCountries() {
    return this.countryService.getCountries();
  }
}
