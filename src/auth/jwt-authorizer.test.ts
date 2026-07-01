import { SignJWT } from 'jose';

const secret = 'super-secret-signing-value';
const encoded = new TextEncoder().encode(secret);

const makeToken = (claims: Record<string, unknown>, exp: string = '1h') =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(exp).sign(encoded);

/** Load a fresh JwtAuthorizer with the given env so config picks up the values. */
const loadAuthorizer = (env: Record<string, string | undefined>) => {
  let authorizer: any;
  jest.isolateModules(() => {
    const prev = { ...process.env };
    Object.assign(process.env, { AUTH_MODE: 'jwt', AUTH_JWT_SECRET: secret }, env);
    const { JwtAuthorizer } = require('./jwt-authorizer');
    authorizer = new JwtAuthorizer();
    // Restore keys we changed that were previously unset.
    for (const key of Object.keys(env)) {
      if (prev[key] === undefined) delete process.env[key];
    }
  });
  return authorizer;
};

describe('JwtAuthorizer', () => {
  it('returns the sub claim for a valid token', async () => {
    const authorizer = loadAuthorizer({});
    const token = await makeToken({ sub: 'user-123' });
    const result = await authorizer.authorize(`Bearer ${token}`);
    expect(result).toBe('user-123');
  });

  it('returns null for a token signed with the wrong secret', async () => {
    const authorizer = loadAuthorizer({});
    const wrong = await new SignJWT({ sub: 'user-123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-different-secret'));
    const result = await authorizer.authorize(`Bearer ${wrong}`);
    expect(result).toBeNull();
  });

  it('returns null when no Authorization header is present', async () => {
    const authorizer = loadAuthorizer({});
    expect(await authorizer.authorize(undefined)).toBeNull();
  });

  it('honours a custom user id claim', async () => {
    const authorizer = loadAuthorizer({ AUTH_USER_ID_CLAIM: 'uid' });
    const token = await makeToken({ uid: 'custom-999', sub: 'ignored' });
    const result = await authorizer.authorize(`Bearer ${token}`);
    expect(result).toBe('custom-999');
  });

  it('enforces issuer when configured', async () => {
    const authorizer = loadAuthorizer({ AUTH_JWT_ISSUER: 'https://issuer.example' });
    const badIssuer = await makeToken({ sub: 'user-123', iss: 'https://evil.example' });
    expect(await authorizer.authorize(`Bearer ${badIssuer}`)).toBeNull();

    const goodIssuer = await new SignJWT({ sub: 'user-123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('https://issuer.example')
      .setExpirationTime('1h')
      .sign(encoded);
    expect(await authorizer.authorize(`Bearer ${goodIssuer}`)).toBe('user-123');
  });

  it('rejects a token whose algorithm is not in the pinned allowlist', async () => {
    // Secret source defaults to HS256; pin to RS256 so the HS256 token is refused.
    const authorizer = loadAuthorizer({ AUTH_JWT_ALGORITHMS: 'RS256' });
    const token = await makeToken({ sub: 'user-123' });
    expect(await authorizer.authorize(`Bearer ${token}`)).toBeNull();
  });

  it('accepts a token whose algorithm is in the pinned allowlist', async () => {
    const authorizer = loadAuthorizer({ AUTH_JWT_ALGORITHMS: 'HS256' });
    const token = await makeToken({ sub: 'user-123' });
    expect(await authorizer.authorize(`Bearer ${token}`)).toBe('user-123');
  });
});
