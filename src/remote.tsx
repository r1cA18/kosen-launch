import type { Context, Hono } from 'hono';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { OAuth, OAuthError } from './oauth';
import { createMcpServer, fetchApi, loadSkillCatalog } from './mcp-tools';
import type { Identity, Store } from './store';
import { ConsentPage, ErrorPage } from './ui';

type Env = { Variables: { identity: Identity | null } };
const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'];

/** Paths that are called without a browser session and are exempt from the Origin check. */
export const remotePaths = ['/mcp', '/oauth/token', '/oauth/register'];

/** A stored-only ZIP with one skill folder, as claude.ai expects `<skill>/SKILL.md`. */
export function skillZip(skill: string) {
  const name = new TextEncoder().encode('kosen-portfolio/SKILL.md');
  const data = new TextEncoder().encode(skill);
  const crc = Bun.hash.crc32(data);
  const local = new Uint8Array(30 + name.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, 0x0800, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, 0x0800, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(38, 0o100644 * 65536, true);
  central.set(name, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + data.length, true);
  return new Blob([local, data, central, end]);
}

export function remoteRoutes(
  app: Hono<Env>,
  store: Store,
  options: { origin: string; skillPath: string },
) {
  const registrations: number[] = [];
  const origin = options.origin;
  const resource = `${origin}/mcp`;
  const metadataUrl = `${origin}/.well-known/oauth-protected-resource`;
  const oauth = new OAuth(store, resource);
  const skills = Bun.file(options.skillPath).text().then(loadSkillCatalog);
  const local = loopbackHosts.includes(new URL(origin).hostname);

  const cors = (c: Context<Env>) => c.header('Access-Control-Allow-Origin', '*');
  const protectedResource = (c: Context<Env>) => {
    cors(c);
    return c.json({
      resource,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      resource_name: 'Kosen Launch',
      resource_documentation: `${origin}/settings?tab=agent`,
    });
  };
  app.get('/.well-known/oauth-protected-resource', protectedResource);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResource);
  app.get('/.well-known/oauth-authorization-server', (c) => {
    cors(c);
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
      service_documentation: `${origin}/settings?tab=agent`,
    });
  });

  const oauthError = (c: Context<Env>, error: unknown) => {
    const e =
      error instanceof OAuthError
        ? error
        : new OAuthError('server_error', '処理を完了できませんでした。', 500);
    if (e.status === 500) console.error('OAuth request failed');
    c.header('Pragma', 'no-cache');
    return c.json({ error: e.code, error_description: e.message }, e.status as 400);
  };
  app.post('/oauth/register', async (c) => {
    const now = Date.now();
    while (registrations.length && registrations[0] < now - 3600_000) registrations.shift();
    if (registrations.length >= 30)
      return c.json(
        {
          error: 'temporarily_unavailable',
          error_description: '登録が多すぎます。時間をおいて試してください。',
        },
        429,
      );
    registrations.push(now);
    try {
      const body = await c.req.json().catch(() => {
        throw new OAuthError('invalid_client_metadata', 'JSONで送信してください。');
      });
      return c.json(oauth.register(body), 201);
    } catch (error) {
      return oauthError(c, error);
    }
  });
  app.post('/oauth/token', async (c) => {
    try {
      if (!c.req.header('Content-Type')?.includes('application/x-www-form-urlencoded'))
        throw new OAuthError(
          'invalid_request',
          'application/x-www-form-urlencodedで送信してください。',
        );
      const body = Object.fromEntries(
        Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]),
      );
      c.header('Pragma', 'no-cache');
      if (body.grant_type === 'authorization_code') return c.json(oauth.exchange(body));
      if (body.grant_type === 'refresh_token') return c.json(oauth.refresh(body));
      throw new OAuthError('unsupported_grant_type', '対応していないgrant_typeです。');
    } catch (error) {
      return oauthError(c, error);
    }
  });

  const consentFields = ['client_id', 'redirect_uri', 'response_type', 'code_challenge'];
  const authorizeParams = (input: Record<string, unknown>) =>
    Object.fromEntries(
      [...consentFields, 'code_challenge_method', 'state', 'resource', 'scope']
        .filter((k) => typeof input[k] === 'string')
        .map((k) => [k, (input[k] as string).slice(0, 2000)]),
    ) as Record<string, string>;
  app.get('/oauth/authorize', (c) => {
    const params = authorizeParams(c.req.query());
    const checked = oauth.authorize(params);
    if (!checked.ok && checked.untrusted)
      return c.html(<ErrorPage message={checked.message} />, 400);
    if (!checked.ok) return c.redirect(checked.redirect, 302);
    const identity = c.get('identity');
    if (identity?.mode !== 'session') {
      const back = new URL(c.req.url);
      return c.redirect(`/login?next=${encodeURIComponent(back.pathname + back.search)}`, 302);
    }
    const target = new URL(checked.request.redirect_uri);
    // The consent form redirects to the client, so form-action must allow its origin.
    c.header(
      'Content-Security-Policy',
      `default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; form-action 'self' ${target.origin}; base-uri 'none'`,
    );
    return c.html(
      <ConsentPage
        user={identity.user}
        client={checked.request.client.name}
        host={target.host}
        loopback={target.protocol === 'http:'}
        fields={params}
      />,
    );
  });
  app.post('/oauth/authorize', async (c) => {
    const identity = c.get('identity');
    const body = await c.req.parseBody();
    const params = authorizeParams(body);
    const checked = oauth.authorize(params);
    if (!checked.ok && checked.untrusted)
      return c.html(<ErrorPage message={checked.message} />, 400);
    if (!checked.ok) return c.redirect(checked.redirect, 303);
    if (identity?.mode !== 'session')
      return c.html(<ErrorPage message="ログインしてからもう一度接続してください。" />, 401);
    const { request } = checked;
    if (body.decision !== 'allow')
      return c.redirect(
        oauth.redirect(request.redirect_uri, { error: 'access_denied', state: request.state }),
        303,
      );
    const code = oauth.issueCode(identity.user.id, request);
    return c.redirect(oauth.redirect(request.redirect_uri, { code, state: request.state }), 303);
  });

  const mcp = createMcpHandler(
    async (ctx) =>
      createMcpServer(fetchApi(app.fetch, origin, ctx.authInfo!.token), {
        localFiles: false,
        skills,
      }),
    { onerror: () => {} },
  );
  const rpcError = (status: number, message: string) =>
    Response.json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }, { status });
  app.all('/mcp', async (c) => {
    // DNS rebinding: browsers send Origin; only this site may call. Loopback servers also check Host.
    const requestOrigin = c.req.header('Origin');
    if (requestOrigin && requestOrigin !== origin) return rpcError(403, 'Origin is not allowed.');
    const host = c.req.header('Host') ?? new URL(c.req.url).host;
    if (local && !loopbackHosts.includes(new URL(`http://${host}`).hostname))
      return rpcError(403, 'Host is not allowed.');
    const header = c.req.header('Authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const identity = token ? store.identity(token, 'agent') : null;
    if (!identity) {
      const challenge = token
        ? `Bearer resource_metadata="${metadataUrl}", error="invalid_token", error_description="The access token is invalid or expired."`
        : `Bearer resource_metadata="${metadataUrl}"`;
      return new Response(
        JSON.stringify({
          error: token ? 'invalid_token' : 'unauthorized',
          error_description: '接続し直してください。',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': challenge },
        },
      );
    }
    return mcp.fetch(c.req.raw, {
      authInfo: { token, clientId: 'kosen-launch', scopes: [], resource: new URL(resource) },
    });
  });

  app.get('/downloads/kosen-portfolio-skill.zip', async (c) => {
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', 'attachment; filename="kosen-portfolio-skill.zip"');
    return c.body(await skillZip(await Bun.file(options.skillPath).text()).arrayBuffer());
  });
}
