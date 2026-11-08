import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest, secret, type Store } from './store';

/** OAuth error answered as RFC 6749 JSON, or redirected back when the redirect URI is trusted. */
export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export type Client = { id: string; name: string; redirect_uris: string[] };
export type AuthorizeRequest = {
  client: Client;
  redirect_uri: string;
  state?: string;
  code_challenge: string;
  resource: string;
};

export const accessLifetime = 3600 * 1000;
export const refreshLifetime = 30 * 86400 * 1000;
export const codeLifetime = 2 * 60 * 1000;
const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'];
const now = () => Date.now();
const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

function parseUri(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
/** Redirect URIs must be HTTPS or an http loopback address (MCP Communication Security). */
export function allowedRedirect(value: string) {
  const url = parseUri(value);
  if (!url || url.hash || url.username || url.password || value.includes('#')) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && loopbackHosts.includes(url.hostname);
}
/** Exact match, except that loopback redirects ignore the port (RFC 8252 section 7.3). */
export function matchesRedirect(registered: string[], given: string) {
  if (registered.includes(given)) return true;
  const url = parseUri(given);
  if (!url || url.protocol !== 'http:' || !loopbackHosts.includes(url.hostname)) return false;
  return registered.some((r) => {
    const reg = parseUri(r);
    return (
      !!reg &&
      reg.protocol === 'http:' &&
      reg.hostname === url.hostname &&
      reg.pathname === url.pathname &&
      reg.search === url.search
    );
  });
}

const registration = z.object({
  redirect_uris: z.array(z.string().max(500)).min(1).max(5),
  client_name: z.string().trim().max(100).optional(),
});

export class OAuth {
  constructor(
    private store: Store,
    /** The canonical MCP server URI, used as the protected resource and token audience. */
    public resource: string,
  ) {}
  register(input: unknown) {
    const parsed = registration.safeParse(input);
    if (!parsed.success)
      throw new OAuthError('invalid_client_metadata', 'redirect_urisを指定してください。');
    const { redirect_uris } = parsed.data;
    if (!redirect_uris.every(allowedRedirect))
      throw new OAuthError(
        'invalid_redirect_uri',
        'リダイレクトURIはHTTPSかループバックアドレスを指定してください。',
      );
    const client = {
      id: randomUUID(),
      name: parsed.data.client_name || 'MCPクライアント',
      redirect_uris,
    };
    this.store.db
      .query('INSERT INTO oauth_clients VALUES(?,?,?,?)')
      .run(client.id, client.name, JSON.stringify(redirect_uris), new Date().toISOString());
    return {
      client_id: client.id,
      client_id_issued_at: Math.floor(now() / 1000),
      client_name: client.name,
      redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  client(id: string): Client | null {
    const row = this.store.db
      .query('SELECT id,name,redirect_uris FROM oauth_clients WHERE id=?')
      .get(id) as { id: string; name: string; redirect_uris: string } | null;
    return row ? { ...row, redirect_uris: JSON.parse(row.redirect_uris) } : null;
  }
  /** Accepts the canonical resource with or without a trailing slash; a missing value means this server. */
  private checkResource(value: string | undefined) {
    if (value === undefined || value === '') return;
    if (value.replace(/\/$/, '') !== this.resource)
      throw new OAuthError('invalid_target', 'このサーバー以外のresourceは指定できません。');
  }
  /**
   * Validates an authorization request. Client and redirect URI problems are returned as
   * `untrusted` because the error must not be redirected to an unverified URI.
   */
  authorize(
    params: Record<string, string | undefined>,
  ):
    | { ok: true; request: AuthorizeRequest }
    | { ok: false; untrusted: true; message: string }
    | { ok: false; untrusted: false; redirect: string } {
    const client = this.client(params.client_id ?? '');
    const redirect_uri = params.redirect_uri ?? '';
    if (!client || !matchesRedirect(client.redirect_uris, redirect_uri))
      return {
        ok: false,
        untrusted: true,
        message: '接続元のアプリを確認できませんでした。アプリからもう一度接続してください。',
      };
    const fail = (error: string) => ({
      ok: false as const,
      untrusted: false as const,
      redirect: this.redirect(redirect_uri, { error, state: params.state }),
    });
    if (params.response_type !== 'code') return fail('unsupported_response_type');
    if (
      params.code_challenge_method !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge ?? '')
    )
      return fail('invalid_request');
    try {
      this.checkResource(params.resource);
    } catch {
      return fail('invalid_target');
    }
    return {
      ok: true,
      request: {
        client,
        redirect_uri,
        state: params.state,
        code_challenge: params.code_challenge!,
        resource: this.resource,
      },
    };
  }
  redirect(uri: string, params: Record<string, string | undefined>) {
    const url = new URL(uri);
    for (const [key, value] of Object.entries({ ...params, iss: new URL(this.resource).origin }))
      if (value !== undefined) url.searchParams.set(key, value);
    return url.toString();
  }
  issueCode(userId: string, request: AuthorizeRequest) {
    const code = secret();
    this.store.db.query('DELETE FROM oauth_codes WHERE expires<?').run(now() - 86400000);
    this.store.db
      .query(
        'INSERT INTO oauth_codes(hash,client_id,user_id,redirect_uri,challenge,resource,expires) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        digest(code),
        request.client.id,
        userId,
        request.redirect_uri,
        request.code_challenge,
        request.resource,
        now() + codeLifetime,
      );
    return code;
  }
  private tokens(grantId: string) {
    const access = 'kla_' + secret(),
      refresh = 'klr_' + secret();
    this.store.db
      .query(
        'UPDATE oauth_grants SET access_hash=?,access_expires=?,refresh_hash=?,refresh_expires=? WHERE id=?',
      )
      .run(
        digest(access),
        now() + accessLifetime,
        digest(refresh),
        now() + refreshLifetime,
        grantId,
      );
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: accessLifetime / 1000,
      refresh_token: refresh,
    };
  }
  /** authorization_code grant: one use, short lived, bound to client, redirect URI and PKCE. */
  exchange(params: Record<string, string | undefined>) {
    const hash = digest(params.code ?? '');
    const row = this.store.db.query('SELECT * FROM oauth_codes WHERE hash=?').get(hash) as {
      client_id: string;
      user_id: string;
      redirect_uri: string;
      challenge: string;
      expires: number;
      grant_id: string | null;
    } | null;
    const invalid = () => new OAuthError('invalid_grant', '認可コードが無効です。');
    if (!row) throw invalid();
    // Claim the code before any check so a failed or repeated attempt cannot use it again.
    if (
      !this.store.db.query('UPDATE oauth_codes SET used=1 WHERE hash=? AND used=0').run(hash)
        .changes
    ) {
      // A replayed code revokes what it issued (OAuth 2.1 section 4.1.3).
      if (row.grant_id)
        this.store.db.query('UPDATE oauth_grants SET revoked=1 WHERE id=?').run(row.grant_id);
      throw invalid();
    }
    const verifier = params.code_verifier ?? '';
    if (
      row.expires <= now() ||
      row.client_id !== params.client_id ||
      row.redirect_uri !== params.redirect_uri ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
      s256(verifier) !== row.challenge
    )
      throw invalid();
    this.checkResource(params.resource);
    const client = this.client(row.client_id)!;
    const id = randomUUID();
    return this.store.db.transaction(() => {
      this.store.db
        .query('INSERT INTO oauth_grants VALUES(?,?,?,?,?,0,?,0,0,?)')
        .run(
          id,
          row.user_id,
          client.id,
          `${client.name}（コネクタ）`,
          'pending-a-' + id,
          'pending-r-' + id,
          new Date().toISOString(),
        );
      this.store.db.query('UPDATE oauth_codes SET grant_id=? WHERE hash=?').run(id, hash);
      return this.tokens(id);
    })();
  }
  /** refresh_token grant with rotation: the presented refresh token stops working. */
  refresh(params: Record<string, string | undefined>) {
    return this.store.db.transaction(() => {
      const row = this.store.db
        .query(
          'SELECT id,client_id FROM oauth_grants WHERE refresh_hash=? AND refresh_expires>? AND revoked=0',
        )
        .get(digest(params.refresh_token ?? ''), now()) as { id: string; client_id: string } | null;
      if (!row || row.client_id !== params.client_id)
        throw new OAuthError('invalid_grant', '更新トークンが無効です。');
      this.checkResource(params.resource);
      return this.tokens(row.id);
    })();
  }
}
