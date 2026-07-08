import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SCHEDULE_TYPES } from '../../schedule/dto/create-schedule.dto';

// Args the AI proposes/executes for medication creation — one medication,
// one dosage form, one schedule per call (multi-form regimens are out of
// scope for chat; users are pointed to the Medications screen for those).
export class CreateMedicationArgsDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsDateString()
  startDate: string;

  @IsString()
  dosageFormType: string;

  @IsInt()
  dosageAmount: number;

  @IsOptional()
  @IsString()
  dosageUnit?: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantityOnHand?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  refillThreshold?: number;

  @IsIn(SCHEDULE_TYPES)
  scheduleType: string;

  @IsOptional()
  @IsInt()
  intervalValue?: number;

  @IsOptional()
  @IsString()
  intervalUnit?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specificTimes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  daysOfWeek?: string[];

  @IsOptional()
  @IsDateString()
  firstDoseAt?: string;

  @IsOptional()
  @IsBoolean()
  asNeeded?: boolean;
}

export class PendingMedicationActionDto {
  @IsIn(['create_medication'])
  tool: 'create_medication';

  @ValidateNested()
  @Type(() => CreateMedicationArgsDto)
  args: CreateMedicationArgsDto;
}

export class ChatMessageDto {
  // Only user/assistant turns are allowed — never let the client inject a
  // 'system' role that could override the medical-safety guardrails.
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  content: string;

  // Carried on an assistant turn that proposed creating a medication but
  // hasn't been confirmed yet. Echoed back verbatim by the client on the
  // next turn so the server knows what a follow-up "yes" should execute.
  @IsOptional()
  @ValidateNested()
  @Type(() => PendingMedicationActionDto)
  pendingAction?: PendingMedicationActionDto;
}

export class ChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

  // IANA timezone captured client-side (Intl.DateTimeFormat().resolvedOptions().timeZone),
  // used when creating a medication's schedule so reminders fire at the
  // correct local wall-clock time. Never guessed by the model.
  @IsOptional()
  @IsString()
  timezone?: string;
}
