import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PendingMedicationActionDto {
  @IsIn(['create_medication'])
  tool: 'create_medication';

  // Only ever echoed back by builds that predate server-side history, and
  // ignored (see ChatDto.history). Not validated field by field: the proposal
  // shape gained drugs[] and endDate, and an old build echoing a new-shape
  // proposal must not 400 the whole message under forbidNonWhitelisted.
  @IsObject()
  args: Record<string, unknown>;
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
  /**
   * @deprecated Ignored since the conversation moved server-side.
   *
   * Still accepted so an older build does not 400 against the strict
   * ValidationPipe, but nothing reads it. It used to carry `pendingAction`,
   * which meant a client could present a medication proposal the assistant
   * had never made and get it created — the thread in `ai_messages` is now
   * the only thing that can confirm what the server actually said.
   */
  history?: ChatMessageDto[];

  // IANA timezone captured client-side (Intl.DateTimeFormat().resolvedOptions().timeZone),
  // used when creating a medication's schedule so reminders fire at the
  // correct local wall-clock time. Never guessed by the model.
  @IsOptional()
  @IsString()
  timezone?: string;
}
