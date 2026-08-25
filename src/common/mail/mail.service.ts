import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Minimal transactional mail sender. Uses Resend's HTTP API when
 * RESEND_API_KEY is configured (no SDK dependency — it's a single POST);
 * otherwise logs the message so the forgot-password flow stays fully
 * exercisable in development without a mail account.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(this.config.get<string>('RESEND_API_KEY'));
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from =
      this.config.get<string>('MAIL_FROM') ?? 'ReMed <onboarding@resend.dev>';

    if (!apiKey) {
      // Dev fallback: surface the content instead of dropping it silently.
      this.logger.warn(
        `RESEND_API_KEY not set — email to ${to} not sent. Subject: "${subject}". Body: ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`,
      );
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Callers deliberately don't get mail errors surfaced to the client —
      // forgot-password must not leak whether an address exists.
      this.logger.error(`Mail send failed (${res.status}): ${body}`);
    }
  }
}
