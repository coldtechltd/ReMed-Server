import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PRIVACY_POLICY_HTML, TERMS_OF_SERVICE_HTML } from './legal.content';

/**
 * Deliberately public — no `JwtAuthGuard`. App Store Connect and the Play
 * Console fetch these URLs anonymously during review, and the paywall links to
 * them before the user has an account.
 */
@ApiExcludeController()
@Controller()
export class LegalController {
  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  privacy(): string {
    return PRIVACY_POLICY_HTML;
  }

  @Get('terms')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  terms(): string {
    return TERMS_OF_SERVICE_HTML;
  }
}
