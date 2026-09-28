import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { NotificationsService } from '../../notifications/notifications.service';

// Writes that can change which dose reminders a device should hold. Kept as a
// path list rather than a call in each service because the set is wide
// (medications, forms, schedules, dose events, reminder preferences) and a
// forgotten call site is a phantom reminder on someone's other phone.
const SYNC_PATH_PREFIXES = [
  '/dose-event',
  '/medication',
  '/dosage-form',
  '/schedule',
  '/notifications/preferences',
];

// Matched by the prefixes above but change nothing a reminder depends on.
// `/notifications/local-reminders` isn't matched at all, which matters: it is
// the sync itself, and nudging from it would loop.
const NON_SYNC_PATHS = ['/medication/check-warnings', '/medication-name'];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * After a successful write that affects dose reminders, asks
 * NotificationsService to nudge the user's *other* devices to re-sync their
 * on-phone reminders. See NotificationsService.requestDeviceSync.
 */
@Injectable()
export class DeviceSyncInterceptor implements NestInterceptor {
  constructor(private readonly notifications: NotificationsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      path: string;
      user?: { id: string; deviceId?: string };
    }>();

    const relevant =
      WRITE_METHODS.has(request.method) &&
      SYNC_PATH_PREFIXES.some((p) => request.path.startsWith(p)) &&
      !NON_SYNC_PATHS.some((p) => request.path.startsWith(p));

    return next.handle().pipe(
      tap(() => {
        // tap's next only runs on success; a rejected write changed nothing.
        const user = request.user;
        if (relevant && user?.id) {
          this.notifications.requestDeviceSync(user.id, user.deviceId);
        }
      }),
    );
  }
}
