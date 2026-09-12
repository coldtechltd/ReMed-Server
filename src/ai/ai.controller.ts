import {
  Body,
  Controller,
  Post,
  Request,
  UseGuards,
  Get,
  Delete,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService, PendingAction } from './ai.service';
import { ChatDto } from './dto/chat.dto';
import { TipsDto } from './dto/tips.dto';

// Groq calls cost money — cap usage at 20 requests / minute per IP.
@Throttle({ default: { limit: 20, ttl: 60000 } })
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('tips')
  @ApiOperation({
    summary: 'Get personalised wellness tips (cached 24h unless force is set)',
  })
  async getTips(
    @Request() req,
    @Body() dto: TipsDto,
  ): Promise<{ tips: string[] }> {
    const tips = await this.aiService.getTips(req.user.id, dto?.force ?? false);
    return { tips };
  }

  @Post('chat')
  @ApiOperation({ summary: 'Chat with the wellness assistant' })
  async chat(
    @Request() req,
    @Body() dto: ChatDto,
  ): Promise<{ reply: string; pendingAction?: PendingAction }> {
    return this.aiService.chat(
      req.user.id,
      dto.message,
      dto.history,
      dto.timezone,
    );
  }

  @Get('chat/history')
  @ApiOperation({ summary: 'The stored AI conversation for this user' })
  getHistory(@Request() req, @Query('limit') limit?: string) {
    return this.aiService
      .getHistory(req.user.id, limit ? Number(limit) : undefined)
      .then((messages) => ({ messages }));
  }

  @Delete('chat/history')
  @ApiOperation({ summary: 'Clear the stored AI conversation' })
  clearHistory(@Request() req) {
    return this.aiService.clearHistory(req.user.id);
  }
}
