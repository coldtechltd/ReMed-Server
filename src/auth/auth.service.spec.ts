import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: 'DRIZZLE_CLIENT',
          useValue: {},
        },
        {
          provide: JwtService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('AuthService.refreshTokens', () => {
  const user = { id: 'user-1', email: 'a@b.c' };
  const session = { id: 'sess-1', deviceId: 'device-1', tokenVersion: 2 };
  const validPayload = {
    sub: user.id,
    email: user.email,
    deviceId: session.deviceId,
    tokenVersion: session.tokenVersion,
    type: 'refresh',
  };

  // Chainable stand-in for the drizzle client: each select() call resolves to
  // the next queued result set, in call order (users → device_sessions →
  // profiles for hasUserProfile).
  const makeDb = (selectResults: any[][]) => {
    let call = 0;
    return {
      select: jest.fn(() => ({
        from: () => ({
          where: () => Promise.resolve(selectResults[call++] ?? []),
        }),
      })),
      update: jest.fn(() => ({
        set: () => ({ where: () => Promise.resolve() }),
      })),
    };
  };

  const makeJwt = (verifyResult: any) =>
    ({
      verify: jest.fn(() => {
        if (verifyResult instanceof Error) throw verifyResult;
        return verifyResult;
      }),
      sign: jest.fn(
        (payload: any) => (payload.type === 'refresh' ? 'new-rt' : 'new-at'),
      ),
    }) as any;

  it('rejects a token that fails verification', async () => {
    const service = new AuthService(makeDb([]) as any, makeJwt(new Error()));
    await expect(service.refreshTokens('bad')).rejects.toThrow(
      'Invalid refresh token',
    );
  });

  it('rejects an access token replayed as a refresh token', async () => {
    const { type: _type, ...accessPayload } = validPayload;
    const service = new AuthService(
      makeDb([[user], [session]]) as any,
      makeJwt(accessPayload),
    );
    await expect(service.refreshTokens('access-token')).rejects.toThrow(
      'Invalid refresh token',
    );
  });

  it('rejects when the device session was revoked (tokenVersion moved)', async () => {
    const service = new AuthService(
      makeDb([[user], [{ ...session, tokenVersion: 3 }]]) as any,
      makeJwt(validPayload),
    );
    await expect(service.refreshTokens('rt')).rejects.toThrow(
      'Token has been revoked',
    );
  });

  it('rejects when the device session is gone', async () => {
    const service = new AuthService(
      makeDb([[user], []]) as any,
      makeJwt(validPayload),
    );
    await expect(service.refreshTokens('rt')).rejects.toThrow(
      'Token has been revoked',
    );
  });

  it('returns a rotated token pair for a valid refresh token', async () => {
    const db = makeDb([[user], [session], [{ id: 'profile-1' }]]);
    const service = new AuthService(db as any, makeJwt(validPayload));
    const result = await service.refreshTokens('rt');
    expect(result).toEqual({
      accessToken: 'new-at',
      refreshToken: 'new-rt',
      hasProfile: true,
    });
    // lastSeenAt touch
    expect(db.update).toHaveBeenCalled();
  });
});
