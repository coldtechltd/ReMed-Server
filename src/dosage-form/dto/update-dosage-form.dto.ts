import { PartialType } from '@nestjs/swagger';
import { CreateDosageFormDto } from './create-dosage-form.dto';

export class UpdateDosageFormDto extends PartialType(CreateDosageFormDto) {}
