import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLogger');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user } = request;
    const userId = user?.sub || 'anonymous';
    const timestamp = new Date().toISOString();

    // Sensitive resources that need strict auditing
    const sensitiveResources = [
      '/medication',
      '/condition',
      '/profile',
      '/dose-event',
      '/reminder',
    ];

    const isSensitive = sensitiveResources.some(res => url.includes(res));

    return next.handle().pipe(
      tap(() => {
        if (isSensitive || method !== 'GET') {
          // Log actions on sensitive data or any state-changing action
          this.logger.log(
            JSON.stringify({
              timestamp,
              userId,
              method,
              url,
              action: this.getActionLabel(method, url),
            }),
          );
        }
      }),
    );
  }

  private getActionLabel(method: string, url: string): string {
    if (method === 'GET') return 'READ';
    if (method === 'POST') return 'CREATE';
    if (method === 'PUT' || method === 'PATCH') return 'UPDATE';
    if (method === 'DELETE') return 'DELETE';
    return 'UNKNOWN';
  }
}
