import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { ChatDto } from './dto/chat.dto';

// Groq calls cost money — cap usage at 20 requests / minute per IP.
@Throttle({ default: { limit: 20, ttl: 60000 } })
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('tips')
  @ApiOperation({ summary: 'Get personalised wellness tips' })
  async getTips(@Request() req): Promise<{ tips: string[] }> {
    const tips = await this.aiService.getTips(req.user.id);
    return { tips };
  }

  @Post('chat')
  @ApiOperation({ summary: 'Chat with the wellness assistant' })
  async chat(@Request() req, @Body() dto: ChatDto): Promise<{ reply: string }> {
    const reply = await this.aiService.chat(
      req.user.id,
      dto.message,
      dto.history,
    );
    return { reply };
  }
}
