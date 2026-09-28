import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { MAX_LOCAL_REMINDERS } from '../local-reminders.util';

export class LocalReminderEntryDto {
  @ApiProperty({ description: 'Dose event the device scheduled on-phone.' })
  @IsUUID()
  eventId: string;

  @ApiProperty({
    description:
      "The event's updatedAt exactly as the snapshot returned it. The claim " +
      'lapses for that dose as soon as the event changes.',
  })
  @IsISO8601()
  updatedAt: string;
}

export class ClaimLocalRemindersDto {
  @ApiProperty({
    type: [LocalReminderEntryDto],
    description:
      'Every reminder the device successfully scheduled. Replaces any earlier claim; ' +
      'an empty list releases it.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_LOCAL_REMINDERS)
  @ValidateNested({ each: true })
  @Type(() => LocalReminderEntryDto)
  reminders: LocalReminderEntryDto[];
}
