import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ChatMessageDto {
  // Only user/assistant turns are allowed — never let the client inject a
  // 'system' role that could override the medical-safety guardrails.
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  content: string;
}

export class ChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];
}
