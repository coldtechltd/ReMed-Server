import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetRemindersDto {
  @ApiProperty({
    description:
      'Turn reminders on or off for every schedule under this medication.',
  })
  @IsBoolean()
  enabled: boolean;
}
