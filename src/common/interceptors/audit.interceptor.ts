import {
  Injectable,
  Inject,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DRIZZLE_CLIENT } from '../../db/drizzle.module';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLogger');

  constructor(
    @Inject(DRIZZLE_CLIENT)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user, ip } = request;
    const userId: string | undefined = user?.id;
    const timestamp = new Date().toISOString();

    // Sensitive resources that need strict auditing
    const sensitiveResources = [
      '/medication',
      '/condition',
      '/profile',
      '/dose-event',
      '/reminder',
      '/companion',
    ];

    const isSensitive = sensitiveResources.some((res) => url.includes(res));

    return next.handle().pipe(
      tap(() => {
        if (isSensitive || method !== 'GET') {
          const action = this.getActionLabel(method);
          // Set by CompanionAccessGuard, which runs before interceptors. When
          // present the caller is reading someone else's health data, and both
          // parties have to be on the record — the audit trail is what makes
          // the sharing feature defensible.
          const subjectUserId: string | null =
            request.companionLink?.ownerId ?? null;
          // Log actions on sensitive data or any state-changing action
          this.logger.log(
            JSON.stringify({
              timestamp,
              userId: userId ?? 'anonymous',
              subjectUserId,
              method,
              url,
              action,
            }),
          );
          // Persisted trail. Fire-and-forget: auditing must never fail the
          // request it observes, so DB errors are logged and swallowed.
          this.db
            .insert(schema.auditLogs)
            .values({
              userId: userId ?? null,
              subjectUserId,
              method,
              url,
              action,
              ip: typeof ip === 'string' ? ip.slice(0, 64) : null,
            })
            .catch((e: unknown) =>
              this.logger.warn(`audit persist failed: ${e}`),
            );
        }
      }),
    );
  }

  private getActionLabel(method: string): string {
    if (method === 'GET') return 'READ';
    if (method === 'POST') return 'CREATE';
    if (method === 'PUT' || method === 'PATCH') return 'UPDATE';
    if (method === 'DELETE') return 'DELETE';
    return 'UNKNOWN';
  }
}
