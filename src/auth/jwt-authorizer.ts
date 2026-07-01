import {
  createRemoteJWKSet,
  importSPKI,
  jwtVerify,
  JWTPayload,
  JWTVerifyGetKey,
  KeyLike,
} from 'jose';
import { config } from '../config';

type KeyResolver = Uint8Array | KeyLike | JWTVerifyGetKey;

/**
 * Generic, provider-independent JWT authorizer.
 *
 * Verifies a Bearer JWT against a configured JWKS URL, PEM public key or shared
 * secret, with optional issuer/audience checks, and returns a stable user id
 * taken from a configurable claim (default `sub`).
 */
export class JwtAuthorizer {
  private keyPromise: Promise<KeyResolver> | undefined;

  private async getKey(): Promise<KeyResolver> {
    if (!this.keyPromise) {
      this.keyPromise = this.resolveKey();
    }
    return this.keyPromise;
  }

  private async resolveKey(): Promise<KeyResolver> {
    const { jwksUrl, publicKey, secret } = config.auth;
    if (jwksUrl) {
      return createRemoteJWKSet(new URL(jwksUrl));
    }
    if (publicKey) {
      // PEM-encoded SPKI public key. Algorithm inferred from the key.
      return importSPKI(publicKey.replace(/\\n/g, '\n'), 'RS256');
    }
    if (secret) {
      return new TextEncoder().encode(secret);
    }
    throw new Error(
      'JWT auth is enabled but no key source is configured. Set AUTH_JWKS_URL, AUTH_JWT_PUBLIC_KEY or AUTH_JWT_SECRET.'
    );
  }

  /** Verify the Authorization header and return the resolved user id, or null. */
  public async authorize(authorizationHeader: string | undefined): Promise<string | null> {
    const token = this.getToken(authorizationHeader);
    if (!token) {
      return null;
    }

    try {
      const key = await this.getKey();
      const { payload } = await jwtVerify(token, key as any, {
        issuer: config.auth.issuer || undefined,
        audience: config.auth.audience || undefined,
      });
      return this.extractUserId(payload);
    } catch (error) {
      console.error('JWT verification failed:', (error as Error).message);
      return null;
    }
  }

  private extractUserId(payload: JWTPayload): string | null {
    const claim = config.auth.userIdClaim;
    const value = (payload as Record<string, unknown>)[claim];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private getToken(authorizationHeader: string | undefined): string | null {
    if (!authorizationHeader) {
      console.error('Authorization header not found');
      return null;
    }
    const parts = authorizationHeader.split(' ');
    const token = parts.length === 2 ? parts[1] : parts[0];
    if (!token) {
      console.error('Bearer token not found');
      return null;
    }
    return token;
  }
}

export default JwtAuthorizer;
