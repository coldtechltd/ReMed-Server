import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { CompanionService, CompanionLink } from '../companion.service';

/**
 * A request that has passed JwtAuthGuard and then this guard. `companionLink`
 * is read downstream by AuditInterceptor to record whose data was accessed.
 */
export interface CompanionRequest extends Request {
  user: { id: string; email: string; deviceId: string };
  companionLink?: CompanionLink;
}

/**
 * Gates every companion read route. Runs after JwtAuthGuard, resolves the
 * `:ownerId` path param against an active link, and attaches the link so the
 * handler and the audit trail can see whose data is being read.
 *
 * `assertAccess` throws 404 rather than 403 on purpose — see its comment.
 */
@Injectable()
export class CompanionAccessGuard implements CanActivate {
  constructor(private readonly companionService: CompanionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CompanionRequest>();

    request.companionLink = await this.companionService.assertAccess(
      request.user.id,
      request.params.ownerId,
    );
    return true;
  }
}
