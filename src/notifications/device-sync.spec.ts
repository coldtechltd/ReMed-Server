// expo-server-sdk ships ESM, which this Jest config doesn't transform.
jest.mock('expo-server-sdk', () => ({
  Expo: class {
    static isExpoPushToken = () => true;
  },
}));

import { NotificationsService } from './notifications.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

describe('NotificationsService.requestDeviceSync', () => {
  let service: NotificationsService;
  let send: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new NotificationsService(
      {} as never,
      {} as unknown as CronLockService,
    );
    send = jest
      .spyOn(
        service as unknown as { sendDeviceSync: () => Promise<void> },
        'sendDeviceSync',
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => jest.useRealTimers());

  it('coalesces a burst into one push per user', () => {
    service.requestDeviceSync('u1', 'd1');
    service.requestDeviceSync('u1', 'd1');
    service.requestDeviceSync('u1', 'd1');
    expect(send).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('u1', 'd1');
  });

  it('skips no device when changes came from two different devices', () => {
    service.requestDeviceSync('u1', 'd1');
    service.requestDeviceSync('u1', 'd2');
    jest.runAllTimers();
    expect(send).toHaveBeenCalledWith('u1', undefined);
  });

  it('keeps users separate', () => {
    service.requestDeviceSync('u1', 'd1');
    service.requestDeviceSync('u2', 'd9');
    jest.runAllTimers();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh window after sending', () => {
    service.requestDeviceSync('u1', 'd1');
    jest.runAllTimers();
    service.requestDeviceSync('u1', 'd2');
    jest.runAllTimers();
    expect(send).toHaveBeenNthCalledWith(2, 'u1', 'd2');
  });
});
