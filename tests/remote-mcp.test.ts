import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { SkillsClient } from '@modelcontextprotocol/client/ext/skills';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store';
import { createApp } from '../src/app';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const callback = 'https://claude.ai/api/mcp/auth_callback';
const work = {
  title: 'リモートMCPから作成',
  summary: 'リモートMCPの実接続で作成した作品です。',
  kind: 'personal',
  year: null,
  status: 'prototype',
  team_result: '',
  my_roles: ['実装'],
  my_contribution: '試作しました。',
  ingenuity: '',
  outcome: '',
  next_interest: '',
  tags: [],
  asset_ids: [] as string[],
  sources: [],
};
let dir: string, store: Store, server: ReturnType<typeof Bun.serve>, origin: string;
let cookie: string, userId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kosen-remote-'));
  store = new Store();
  const user = await store.register({
    email: 'remote@example.test',
    password: 'test-password-123',
    display_name: 'リモート',
    handle: 'remote-user',
    school: '',
    department: '',
    grade: '',
  });
  userId = user.id;
  cookie = `kl_session=${store.session(user.id)}`;
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('', { status: 503 }),
  });
  origin = `http://127.0.0.1:${server.port}`;
  const app = createApp(store, {
    origin,
    assetDirectory: dir,
    staticDirectory: resolve('public'),
    skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
  });
  server.reload({ fetch: app.fetch });
});
afterAll(async () => {
  await server.stop(true);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const at = (path: string, init: RequestInit = {}) =>
  fetch(origin + path, { redirect: 'manual', ...init });
const form = (body: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(),
});
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
async function registerClient(redirect_uris = [callback], client_name = 'Claude') {
  const response = await at('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris, client_name, token_endpoint_auth_method: 'none' }),
  });
  expect(response.status).toBe(201);
  return (await response.json()).client_id as string;
}
function authorizeQuery(clientId: string, challenge: string, redirect = callback, state = 'st-1') {
  return new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    resource: `${origin}/mcp`,
  }).toString();
}
/** Consent with the session cookie and return the code from the redirect. */
async function code(clientId: string, challenge: string, redirect = callback) {
  const query = authorizeQuery(clientId, challenge, redirect);
  const consent = await at(`/oauth/authorize?${query}`, { headers: { Cookie: cookie } });
  expect(consent.status).toBe(200);
  const allowed = await at('/oauth/authorize', {
    ...form({ ...Object.fromEntries(new URLSearchParams(query)), decision: 'allow' }),
    headers: {
      Cookie: cookie,
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  expect(allowed.status).toBe(303);
  const location = new URL(allowed.headers.get('location')!);
  expect(location.origin + location.pathname).toBe(
    new URL(redirect).origin + new URL(redirect).pathname,
  );
  expect(location.searchParams.get('state')).toBe('st-1');
  expect(location.searchParams.get('iss')).toBe(origin);
  return location.searchParams.get('code')!;
}
const token = (body: Record<string, string>) => at('/oauth/token', form(body));
async function tokens(clientId: string) {
  const { verifier, challenge } = pkce();
  const response = await token({
    grant_type: 'authorization_code',
    code: await code(clientId, challenge),
    client_id: clientId,
    redirect_uri: callback,
    code_verifier: verifier,
    resource: `${origin}/mcp`,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };
}
async function connect(accessToken: string) {
  const client = new Client({ name: 'remote-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  await client.connect(transport);
  return client;
}

describe('OAuthのメタデータ', () => {
  test('Protected Resource MetadataとAuthorization Server Metadata', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const metadata = await (await at(path)).json();
      expect(metadata.resource).toBe(`${origin}/mcp`);
      expect(metadata.authorization_servers).toEqual([origin]);
      expect(metadata.bearer_methods_supported).toEqual(['header']);
    }
    const as = await (await at('/.well-known/oauth-authorization-server')).json();
    expect(as).toMatchObject({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
    });
  });
});

describe('Dynamic Client Registration', () => {
  test('HTTPSとループバックだけを受け付ける', async () => {
    const response = await at('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [callback], client_name: 'Claude' }),
    });
    expect(response.status).toBe(201);
    const client = await response.json();
    expect(client).toMatchObject({
      client_name: 'Claude',
      redirect_uris: [callback],
      token_endpoint_auth_method: 'none',
    });
    for (const redirect of ['http://example.com/cb', 'myapp://cb', 'https://x.test/cb#f', 'nope'])
      expect(
        (
          await at('/oauth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ redirect_uris: [redirect] }),
          })
        ).status,
      ).toBe(400);
    expect((await registerClient(['http://127.0.0.1/callback'])).length).toBeGreaterThan(10);
  });
});

describe('認可コードフロー', () => {
  test('未ログインはログイン後に同意画面へ戻る', async () => {
    const clientId = await registerClient();
    const query = authorizeQuery(clientId, pkce().challenge);
    const first = await at(`/oauth/authorize?${query}`);
    expect(first.status).toBe(302);
    const login = first.headers.get('location')!;
    expect(login).toBe(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
    expect(await (await at(login)).text()).toContain('接続の確認画面へ戻ります');
    const signed = await at(login, {
      ...form({ email: 'remote@example.test', password: 'test-password-123' }),
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(signed.status).toBe(303);
    expect(signed.headers.get('location')).toBe(`/oauth/authorize?${query}`);
    const evil = await at(`/login?next=${encodeURIComponent('https://evil.test/')}`, {
      ...form({ email: 'remote@example.test', password: 'test-password-123' }),
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(evil.headers.get('location')).toBe('/home');
  });

  test('同意画面の表示と拒否とCSRF', async () => {
    const clientId = await registerClient();
    const query = authorizeQuery(clientId, pkce().challenge);
    const consent = await at(`/oauth/authorize?${query}`, { headers: { Cookie: cookie } });
    const html = await consent.text();
    expect(html).toContain('Claude');
    expect(html).toContain('作品の下書き作成と更新案の送信を行います');
    expect(html).toContain('claude.ai');
    expect(consent.headers.get('content-security-policy')).toContain(
      "form-action 'self' https://claude.ai",
    );
    const body = { ...Object.fromEntries(new URLSearchParams(query)), decision: 'deny' };
    const denied = await at('/oauth/authorize', {
      ...form(body),
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    const location = new URL(denied.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.has('code')).toBe(false);
    const forged = await at('/oauth/authorize', {
      ...form({ ...body, decision: 'allow' }),
      headers: {
        Cookie: cookie,
        Origin: 'https://evil.test',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    expect(forged.status).toBe(403);
    const untrusted = await at(
      `/oauth/authorize?${authorizeQuery(clientId, pkce().challenge, 'https://evil.test/cb')}`,
      { headers: { Cookie: cookie } },
    );
    expect(untrusted.status).toBe(400);
    expect(untrusted.headers.get('location')).toBeNull();
    const plain = await at(
      `/oauth/authorize?${authorizeQuery(clientId, pkce().challenge).replace('S256', 'plain')}`,
      { headers: { Cookie: cookie } },
    );
    expect(new URL(plain.headers.get('location')!).searchParams.get('error')).toBe(
      'invalid_request',
    );
  });

  test('ループバックはポートを問わず照合する', async () => {
    const clientId = await registerClient(['http://127.0.0.1/callback'], 'Claude Code');
    const loop = 'http://127.0.0.1:53111/callback';
    const response = await at(
      `/oauth/authorize?${authorizeQuery(clientId, pkce().challenge, loop)}`,
      {
        headers: { Cookie: cookie },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('このパソコンで動くアプリへ戻ります');
  });

  test('PKCEと一回限りのコードとredirect_uriの照合', async () => {
    const clientId = await registerClient();
    const first = pkce();
    const firstCode = await code(clientId, first.challenge);
    const base = { grant_type: 'authorization_code', client_id: clientId, redirect_uri: callback };
    const wrong = await token({ ...base, code: firstCode, code_verifier: pkce().verifier });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toBe('invalid_grant');
    // A failed attempt consumes the code.
    expect((await token({ ...base, code: firstCode, code_verifier: first.verifier })).status).toBe(
      400,
    );

    const second = pkce();
    const secondCode = await code(clientId, second.challenge);
    const redirect = await token({
      ...base,
      redirect_uri: 'https://claude.ai/other',
      code: secondCode,
      code_verifier: second.verifier,
    });
    expect((await redirect.json()).error).toBe('invalid_grant');

    const third = pkce();
    const thirdCode = await code(clientId, third.challenge);
    const other = await token({
      ...base,
      code: thirdCode,
      code_verifier: third.verifier,
      resource: 'https://evil.test/mcp',
    });
    expect((await other.json()).error).toBe('invalid_target');

    const fourth = pkce();
    const fourthCode = await code(clientId, fourth.challenge);
    const ok = await token({ ...base, code: fourthCode, code_verifier: fourth.verifier });
    expect(ok.status).toBe(200);
    const issued = await ok.json();
    expect(issued.token_type).toBe('Bearer');
    expect(issued.expires_in).toBe(3600);
    expect(issued.access_token.startsWith('kla_')).toBe(true);
    expect(
      (await at('/v1/me', { headers: { Authorization: `Bearer ${issued.access_token}` } })).status,
    ).toBe(200);
    // Replaying the code revokes the tokens it issued.
    const replay = await token({ ...base, code: fourthCode, code_verifier: fourth.verifier });
    expect((await replay.json()).error).toBe('invalid_grant');
    expect(
      (await at('/v1/me', { headers: { Authorization: `Bearer ${issued.access_token}` } })).status,
    ).toBe(401);
    expect((await token({ grant_type: 'password' })).status).toBe(400);
    const json = await at('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, code: 'x' }),
    });
    expect((await json.json()).error).toBe('invalid_request');
  });

  test('refresh_tokenのローテーション', async () => {
    const clientId = await registerClient();
    const issued = await tokens(clientId);
    const refreshed = await token({
      grant_type: 'refresh_token',
      refresh_token: issued.refresh_token,
      client_id: clientId,
    });
    expect(refreshed.status).toBe(200);
    const next = await refreshed.json();
    expect(next.refresh_token).not.toBe(issued.refresh_token);
    expect(next.access_token).not.toBe(issued.access_token);
    const reused = await token({
      grant_type: 'refresh_token',
      refresh_token: issued.refresh_token,
      client_id: clientId,
    });
    expect(reused.status).toBe(400);
    expect((await reused.json()).error).toBe('invalid_grant');
    const otherClient = await token({
      grant_type: 'refresh_token',
      refresh_token: next.refresh_token,
      client_id: await registerClient(),
    });
    expect((await otherClient.json()).error).toBe('invalid_grant');
    expect(
      (await at('/v1/me', { headers: { Authorization: `Bearer ${issued.access_token}` } })).status,
    ).toBe(401);
    expect(
      (await at('/v1/me', { headers: { Authorization: `Bearer ${next.access_token}` } })).status,
    ).toBe(200);
  });
});

describe('/mcp', () => {
  test('401とWWW-Authenticate、Originの拒否、GETは405', async () => {
    const init = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    };
    const missing = await at('/mcp', init);
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    );
    const invalid = await at('/mcp', {
      ...init,
      headers: { ...init.headers, Authorization: 'Bearer kla_invalid' },
    });
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get('www-authenticate')).toContain('error="invalid_token"');
    const { access_token } = await tokens(await registerClient());
    const evil = await at('/mcp', {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${access_token}`,
        Origin: 'https://evil.test',
      },
    });
    expect(evil.status).toBe(403);
    const get = await at('/mcp', { headers: { Authorization: `Bearer ${access_token}` } });
    expect(get.status).toBe(405);
  });

  test('SDKのStreamable HTTPクライアントで下書き作成と画像送信', async () => {
    const clientId = await registerClient();
    const { access_token } = await tokens(clientId);
    const client = await connect(access_token);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name).sort()).toEqual([
        'create_work_draft',
        'get_authoring_rules',
        'get_profile',
        'get_work',
        'list_works',
        'prepare_publication',
        'propose_work_changes',
        'upload_image',
      ]);
      const upload = listed.tools.find((t) => t.name === 'upload_image')!;
      expect(Object.keys(upload.inputSchema.properties ?? {}).sort()).toEqual(['alt', 'data']);
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        const result = await client.callTool({ name, arguments: args });
        const content = result.content as { type: string; text: string }[];
        if (result.isError) throw new Error(content[0].text);
        return JSON.parse(content[0].text);
      };
      expect(await call('get_profile')).toEqual({
        handle: 'remote-user',
        display_name: 'リモート',
      });
      const image = await call('upload_image', { data: png, alt: 'リモート画像' });
      expect(image.asset_id).toBeString();
      await expect(
        call('upload_image', { data: Buffer.from('not an image').toString('base64'), alt: 'x' }),
      ).rejects.toThrow('PNG・JPEG・WebP');
      await expect(
        call('upload_image', {
          data: Buffer.alloc(2 * 1024 * 1024 + 10).toString('base64'),
          alt: 'x',
        }),
      ).rejects.toThrow();
      const created = await call('create_work_draft', {
        source_key: 'remote-test',
        work: { ...work, asset_ids: [image.asset_id] },
      });
      expect(created.created).toBe(true);
      expect(store.work(userId, created.work.id).data.asset_ids).toEqual([image.asset_id]);
      const review = await call('prepare_publication', { work_id: created.work.id });
      expect(review.review_url).toBe(`${origin}/works/${created.work.id}/review`);
      expect(store.published()).toHaveLength(0);

      const skills = new SkillsClient(client);
      const { skills: entries } = await skills.list();
      expect(entries.map((s) => s.frontmatter.name)).toEqual(['kosen-portfolio']);
      const skill = await skills.read(entries[0]);
      expect(skill.text).toContain('Kosen Launchの作品作成');

      const publish = await at(`/v1/works/${created.work.id}/publication`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 1, share_to_feed: false }),
      });
      expect(publish.status).toBe(403);
      expect(
        (await at('/settings?tab=agent', { headers: { Authorization: `Bearer ${access_token}` } }))
          .status,
      ).toBe(403);
      expect(store.published()).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  test('Settingsにコネクタとして表示され失効できる', async () => {
    const { access_token } = await tokens(await registerClient());
    const page = await (await at('/settings?tab=agent', { headers: { Cookie: cookie } })).text();
    expect(page).toContain('Claude（コネクタ）');
    expect(page).toContain(`${origin}/mcp`);
    expect(page).toContain(`claude mcp add --transport http kosen-launch ${origin}/mcp`);
    const grant = store.tokens(userId).find((t) => t.kind === 'connector' && !t.revoked)!;
    const client = await connect(access_token);
    expect((await client.listTools()).tools).toHaveLength(8);
    const revoked = await at(`/settings/agents/tokens/${grant.id}/revoke`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin },
    });
    expect(revoked.status).toBe(303);
    await expect(client.callTool({ name: 'list_works', arguments: {} })).rejects.toThrow();
    await client.close().catch(() => {});
    expect(
      (await at('/v1/me', { headers: { Authorization: `Bearer ${access_token}` } })).status,
    ).toBe(401);
  });

  test('発行した連携トークンでもHTTP接続できる', async () => {
    const issued = store.createToken(userId, 'Claude Code');
    const client = await connect(issued.token);
    try {
      const result = await client.callTool({ name: 'get_profile', arguments: {} });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
    }
  });
});

test('Skillのzipを配布する', async () => {
  const response = await at('/downloads/kosen-portfolio-skill.zip');
  expect(response.headers.get('content-type')).toBe('application/zip');
  const path = join(dir, 'skill.zip');
  await Bun.write(path, await response.arrayBuffer());
  const listed = Bun.spawnSync(['unzip', '-l', path]).stdout.toString();
  expect(listed).toContain('kosen-portfolio/SKILL.md');
  const extracted = Bun.spawnSync([
    'unzip',
    '-p',
    path,
    'kosen-portfolio/SKILL.md',
  ]).stdout.toString();
  expect(extracted).toBe(await Bun.file(resolve('skills/kosen-portfolio/SKILL.md')).text());
});
