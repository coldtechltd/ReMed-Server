// expo-server-sdk ships ESM, which this Jest config doesn't transform.
jest.mock('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken = () => true;
  },
}));

import { ExecutionContext } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { DeviceSyncInterceptor } from './device-sync.interceptor';
import { NotificationsService } from '../../notifications/notifications.service';

describe('DeviceSyncInterceptor', () => {
  const requestDeviceSync = jest.fn();
  const interceptor = new DeviceSyncInterceptor({
    requestDeviceSync,
  } as unknown as NotificationsService);

  const run = async (
    method: string,
    path: string,
    { fail = false, user = { id: 'u1', deviceId: 'd1' } } = {},
  ) => {
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ method, path, user }) }),
    } as unknown as ExecutionContext;
    const handler = {
      handle: () => (fail ? throwError(() => new Error('nope')) : of({})),
    };
    await lastValueFrom(interceptor.intercept(context, handler)).catch(
      () => undefined,
    );
  };

  beforeEach(() => requestDeviceSync.mockClear());

  it.each([
    ['PATCH', '/dose-event/abc'],
    ['POST', '/dose-event/log'],
    ['POST', '/medication/full'],
    ['DELETE', '/medication/abc'],
    ['PATCH', '/schedule/abc'],
    ['PATCH', '/dosage-form/abc'],
    ['PATCH', '/notifications/preferences'],
  ])('nudges other devices after %s %s', async (method, path) => {
    await run(method, path);
    expect(requestDeviceSync).toHaveBeenCalledWith('u1', 'd1');
  });

  it.each([
    ['GET', '/dose-event/by-date'],
    ['POST', '/medication/check-warnings'],
    ['PUT', '/notifications/local-reminders'],
    ['POST', '/ai/chat'],
  ])('leaves %s %s alone', async (method, path) => {
    await run(method, path);
    expect(requestDeviceSync).not.toHaveBeenCalled();
  });

  it('does not nudge when the write failed', async () => {
    await run('PATCH', '/dose-event/abc', { fail: true });
    expect(requestDeviceSync).not.toHaveBeenCalled();
  });
});
