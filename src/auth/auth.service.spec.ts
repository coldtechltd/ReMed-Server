import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../common/mail/mail.service';

const configMock = { get: jest.fn() } as any;
const mailMock = { send: jest.fn() } as any;

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
        {
          provide: ConfigService,
          useValue: configMock,
        },
        {
          provide: MailService,
          useValue: mailMock,
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
    const service = new AuthService(makeDb([]) as any, makeJwt(new Error()), configMock, mailMock);
    await expect(service.refreshTokens('bad')).rejects.toThrow(
      'Invalid refresh token',
    );
  });

  it('rejects an access token replayed as a refresh token', async () => {
    const { type: _type, ...accessPayload } = validPayload;
    const service = new AuthService(
      makeDb([[user], [session]]) as any,
      makeJwt(accessPayload),
      configMock,
      mailMock,
    );
    await expect(service.refreshTokens('access-token')).rejects.toThrow(
      'Invalid refresh token',
    );
  });

  it('rejects when the device session was revoked (tokenVersion moved)', async () => {
    const service = new AuthService(
      makeDb([[user], [{ ...session, tokenVersion: 3 }]]) as any,
      makeJwt(validPayload),
      configMock,
      mailMock,
    );
    await expect(service.refreshTokens('rt')).rejects.toThrow(
      'Token has been revoked',
    );
  });

  it('rejects when the device session is gone', async () => {
    const service = new AuthService(
      makeDb([[user], []]) as any,
      makeJwt(validPayload),
      configMock,
      mailMock,
    );
    await expect(service.refreshTokens('rt')).rejects.toThrow(
      'Token has been revoked',
    );
  });

  it('returns a rotated token pair for a valid refresh token', async () => {
    const db = makeDb([[user], [session], [{ id: 'profile-1' }]]);
    const service = new AuthService(db as any, makeJwt(validPayload), configMock, mailMock);
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

describe('AuthService password reset', () => {
  const bcrypt = require('bcrypt');

  // Awaitable-anywhere query chain: every builder method returns the chain,
  // and awaiting it resolves to the queued rows for that select() call.
  const makeChain = (rows: any[]) => {
    const chain: any = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'set', 'values', 'returning']) {
      chain[m] = () => chain;
    }
    chain.then = (res: any, rej: any) => Promise.resolve(rows).then(res, rej);
    return chain;
  };

  const makeDb = (selects: any[][]) => {
    let call = 0;
    const db: any = {
      select: jest.fn(() => makeChain(selects[call++] ?? [])),
      update: jest.fn(() => makeChain([])),
      insert: jest.fn(() => makeChain([])),
    };
    db.transaction = (fn: any) => fn(db);
    return db;
  };

  const build = (db: any) => {
    const mail = { send: jest.fn() };
    const service = new AuthService(
      db,
      { sign: jest.fn(() => 't') } as any,
      { get: jest.fn() } as any,
      mail as any,
    );
    return { service, mail };
  };

  const user = { id: 'user-1', email: 'a@b.c', passwordHash: 'existing-hash' };

  it('does nothing observable for an unknown email', async () => {
    const db = makeDb([[]]);
    const { service, mail } = build(db);
    await service.requestPasswordReset('nobody@b.c');
    expect(db.insert).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('does nothing observable for an OAuth-only account (no password)', async () => {
    const db = makeDb([[{ ...user, passwordHash: null }]]);
    const { service, mail } = build(db);
    await service.requestPasswordReset(user.email);
    expect(db.insert).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('stores a hashed code and emails a 6-digit code', async () => {
    const db = makeDb([[user]]);
    const { service, mail } = build(db);
    await service.requestPasswordReset(user.email);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(mail.send).toHaveBeenCalledTimes(1);
    const html = mail.send.mock.calls[0][2] as string;
    expect(html).toMatch(/\d{6}/);
  });

  it('rejects a wrong code with the generic error', async () => {
    const codeHash = await bcrypt.hash('111111', 4);
    const token = {
      id: 'tok-1',
      codeHash,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    };
    const { service } = build(makeDb([[user], [token]]));
    await expect(
      service.resetPassword(user.email, '222222', 'newpass1'),
    ).rejects.toThrow('Invalid or expired code');
  });

  it('rejects when no live token exists', async () => {
    const { service } = build(makeDb([[user], []]));
    await expect(
      service.resetPassword(user.email, '111111', 'newpass1'),
    ).rejects.toThrow('Invalid or expired code');
  });

  it('resets the password, burns the code, and revokes every device', async () => {
    const codeHash = await bcrypt.hash('123456', 4);
    const token = {
      id: 'tok-1',
      codeHash,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    };
    const db = makeDb([[user], [token]]);
    const { service } = build(db);
    const result = await service.resetPassword(user.email, '123456', 'newpass1');
    expect(result).toEqual({ success: true });
    // users.passwordHash + token.usedAt + deviceSessions.tokenVersion
    expect(db.update).toHaveBeenCalledTimes(3);
  });
});
