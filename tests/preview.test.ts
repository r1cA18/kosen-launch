import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app';
import { Discovery } from '../src/discovery';
import { Opportunities } from '../src/opportunities';
import {
  HTML_LIMIT,
  IMAGE_LIMIT,
  Previews,
  assertPublicUrl,
  extractPreview,
  isBlockedAddress,
  sniffImage,
} from '../src/preview';
import { Store } from '../src/store';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const ico = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]);
const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const hits: Record<string, number> = {};
let server: ReturnType<typeof Bun.serve>;
let dir: string;
const page = (head: string) => `<!doctype html><html><head>${head}</head><body></body></html>`;
const html = (body: string, type = 'text/html; charset=utf-8') =>
  new Response(body, { headers: { 'Content-Type': type } });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kl-preview-'));
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      hits[pathname] = (hits[pathname] ?? 0) + 1;
      switch (pathname) {
        case '/event':
          return html(
            page(`<meta property="og:title" content="Hack &amp; Make 2026">
              <meta property="og:site_name" content="Hack &lt;b&gt;Site">
              <meta property="og:description" content="説明です。&quot;引用&quot;">
              <meta property="og:image" content="/img/cover.png">
              <link rel="icon" href="icon.ico">`),
          );
        case '/twitter':
          return html(
            page(`<meta name="twitter:image" content="/img/cover.png"><title>タイトル</title>`),
          );
        case '/xss':
          return html(
            page(`<meta property="og:site_name" content="&lt;script&gt;alert(1)&lt;/script&gt;">
              <meta property="og:description" content="&lt;img src=x onerror=alert(1)&gt;">
              <meta property="og:image" content="/img/cover.png">`),
          );
        case '/nonimage':
          return html(page(`<meta property="og:image" content="/event">`));
        case '/fakepng':
          return html(page(`<meta property="og:image" content="/img/fake.png">`));
        case '/bigimage':
          return html(page(`<meta property="og:image" content="/img/big.png">`));
        case '/svgpage':
          return html(page(`<meta property="og:image" content="/img/logo.svg">`));
        case '/bightml':
          return html('<!doctype html>' + ' '.repeat(HTML_LIMIT + 10));
        case '/text':
          return html('hello', 'text/plain');
        case '/redirect-ok':
          return new Response(null, { status: 302, headers: { Location: '/event' } });
        case '/redirect-private':
          return new Response(null, {
            status: 302,
            headers: { Location: 'http://private.test/event' },
          });
        case '/loop':
          return new Response(null, { status: 302, headers: { Location: '/loop' } });
        case '/slow':
          return new Promise(() => {});
        case '/img/cover.png':
        case '/img/fake.png':
          return new Response(pathname.endsWith('fake.png') ? '<html>no</html>' : png, {
            headers: { 'Content-Type': 'image/png' },
          });
        case '/img/big.png':
          return new Response(new Uint8Array(IMAGE_LIMIT + 5).fill(1).fill(137, 0, 1), {
            headers: { 'Content-Type': 'image/png' },
          });
        case '/img/logo.svg':
          return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
        case '/icon.ico':
        case '/favicon.ico':
          return new Response(ico, { headers: { 'Content-Type': 'image/x-icon' } });
        case '/sjis': {
          const body = new Uint8Array([
            ...new TextEncoder().encode('<meta property="og:title" content="'),
            0x93,
            0xfa,
            0x96,
            0x7b,
            ...new TextEncoder().encode('">'),
          ]);
          return new Response(body, {
            headers: { 'Content-Type': 'text/html; charset=Shift_JIS' },
          });
        }
        case '/sjis-meta': {
          const body = new Uint8Array([
            ...new TextEncoder().encode(
              '<meta charset="shift_jis"><meta property="og:title" content="',
            ),
            0x93,
            0xfa,
            0x96,
            0x7b,
            ...new TextEncoder().encode('">'),
          ]);
          return new Response(body, { headers: { 'Content-Type': 'text/html' } });
        }
        default:
          return new Response('missing', { status: 404 });
      }
    },
  });
});
afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

// Every *.test host resolves to a public address except private.test; requests go to the mock server.
const publicLookup = async (host: string) =>
  host === 'private.test' ? ['10.0.0.5'] : ['93.184.216.34'];
const toMock = async (url: string, init: RequestInit) => {
  const u = new URL(url);
  return fetch(`http://127.0.0.1:${server.port}${u.pathname}${u.search}`, init);
};
function previewsFor(store: Store, extra: Partial<ConstructorParameters<typeof Previews>[1]> = {}) {
  return new Previews(store, {
    directory: join(dir, 'event-previews'),
    lookup: publicLookup,
    fetch: toMock,
    timeoutMs: 1500,
    ...extra,
  });
}
const files = () => {
  try {
    return readdirSync(join(dir, 'event-previews'));
  } catch {
    return [];
  }
};

test('OGP抽出は相対URLを解決し、ogとtwitterの両方と文字参照に対応する', () => {
  const r = extractPreview(
    page(`<meta property="og:image" content="/a/og.png">
      <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
      <meta property="og:site_name" content="Hack &amp; Co">
      <meta property="og:title" content="  タイトル  ">
      <meta property="og:description" content="&#26085;&#x672c;&quot;語&quot;">
      <link rel="shortcut icon" href="../fav.png">
      <link rel="apple-touch-icon" href="/touch.png">
      <meta property="og:image" content="javascript:alert(1)">`),
    'https://site.example.com/events/2026/index.html',
  );
  expect(r.images).toEqual(['https://site.example.com/a/og.png', 'https://cdn.example.com/tw.jpg']);
  expect(r.icons).toEqual([
    'https://site.example.com/events/fav.png',
    'https://site.example.com/touch.png',
    'https://site.example.com/favicon.ico',
  ]);
  expect(r.site_name).toBe('Hack & Co');
  expect(r.title).toBe('タイトル');
  expect(r.description).toBe('日本"語"');
  const tw = extractPreview(
    page('<meta name="twitter:image" content="x.png"><title>T</title>'),
    'https://a.test/d/',
  );
  expect(tw.images).toEqual(['https://a.test/d/x.png']);
  expect(tw.title).toBe('T');
});

test('プライベート・ループバック・予約帯のアドレスを拒否する', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    '2002:c0a8:101::1',
    '2001:db8::1',
  ])
    expect(isBlockedAddress(ip), ip).toBe(true);
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])
    expect(isBlockedAddress(ip), ip).toBe(false);
  const bad = async (u: string) =>
    assertPublicUrl(u, publicLookup).then(
      () => 'ok',
      (e) => e.message,
    );
  expect(await bad('ftp://a.test/')).toBe('invalid_scheme');
  expect(await bad('file:///etc/passwd')).toBe('invalid_scheme');
  expect(await bad('https://user:pw@a.test/')).toBe('credentials');
  expect(await bad('http://127.0.0.1/')).toBe('blocked_address');
  expect(await bad('http://[::1]/')).toBe('blocked_address');
  expect(await bad('http://2130706433/')).toBe('blocked_address');
  expect(await bad('http://localhost/')).toBe('blocked_host');
  expect(await bad('https://a.test:8080/')).toBe('invalid_port');
  expect(await bad('https://private.test/')).toBe('blocked_address');
  expect(await bad('https://a.test/')).toBe('ok');
});

test('取得して保存し、文字コード・相対アイコン・同一URLの再取得なしを確認する', async () => {
  const store = new Store();
  try {
    const p = previewsFor(store);
    const url = 'https://ev.test/event';
    p.ensure([url, url]);
    await p.idle();
    const row = p.get(url)!;
    expect(row).toMatchObject({
      error: '',
      title: 'Hack & Make 2026',
      site_name: 'Hack <b>Site',
      description: '説明です。"引用"',
      image_mime: 'image/png',
      icon_mime: 'image/x-icon',
    });
    expect(files()).toContain(row.image_id!);
    expect(hits['/event']).toBe(1);
    p.ensure([url]);
    await p.idle();
    expect(hits['/event']).toBe(1);
    // twitter:image only, and favicon.ico fallback
    const t = await p.fetchOne('https://ev.test/twitter');
    expect(t).toMatchObject({ error: '', title: 'タイトル', image_mime: 'image/png' });
    expect(t.icon_mime).toBe('image/x-icon');
    // Shift_JIS by header and by meta
    expect((await p.fetchOne('https://ev.test/sjis')).title).toBe('日本');
    expect((await p.fetchOne('https://ev.test/sjis-meta')).title).toBe('日本');
  } finally {
    store.close();
  }
});

test('リダイレクト先のプライベートIP、リダイレクト過多、内部アドレスを拒否する', async () => {
  const store = new Store();
  try {
    const p = previewsFor(store);
    expect((await p.fetchOne('https://ev.test/redirect-ok')).title).toBe('Hack & Make 2026');
    expect((await p.fetchOne('https://ev.test/redirect-private')).error).toBe('blocked_address');
    expect((await p.fetchOne('https://ev.test/loop')).error).toBe('too_many_redirects');
    expect((await p.fetchOne('https://private.test/event')).error).toBe('blocked_address');
    expect((await p.fetchOne('http://169.254.169.254/latest')).error).toBe('blocked_address');
    expect((await p.fetchOne('https://ev.test/slow')).error).toBe('timeout');
  } finally {
    store.close();
  }
});

test('サイズ超過と非画像を拒否し、本物のSVGとICOは受け入れる', async () => {
  const store = new Store();
  try {
    const p = previewsFor(store);
    expect((await p.fetchOne('https://ev.test/bightml')).error).toBe('too_large');
    expect((await p.fetchOne('https://ev.test/text')).error).toBe('not_html');
    const big = await p.fetchOne('https://ev.test/bigimage');
    expect(big.error).toBe('');
    expect(big.image_id).toBeNull();
    const nonimage = await p.fetchOne('https://ev.test/nonimage');
    expect(nonimage.image_id).toBeNull();
    const fake = await p.fetchOne('https://ev.test/fakepng');
    expect(fake.image_id).toBeNull();
    const logo = await p.fetchOne('https://ev.test/svgpage');
    expect(logo.image_mime).toBe('image/svg+xml');
    expect(sniffImage(new TextEncoder().encode('<script>alert(1)</script>'))).toBeNull();
    expect(sniffImage(ico)?.mime).toBe('image/x-icon');
  } finally {
    store.close();
  }
});

test('失敗は24時間後に再試行する', async () => {
  const store = new Store();
  try {
    let now = Date.now();
    const p = previewsFor(store, { now: () => now });
    await p.fetchOne('https://ev.test/missing');
    expect(p.needs('https://ev.test/missing')).toBe(false);
    now += 23 * 3600000;
    expect(p.needs('https://ev.test/missing')).toBe(false);
    now += 2 * 3600000;
    expect(p.needs('https://ev.test/missing')).toBe(true);
  } finally {
    store.close();
  }
});

async function appWith(store: Store, previews?: Previews) {
  const origin = 'http://127.0.0.1:4177';
  const app = createApp(store, {
    origin,
    assetDirectory: resolve('.data/test-assets'),
    staticDirectory: resolve('public'),
    skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
    previews,
  });
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  for (const handle of ['alice', 'bob']) {
    const res = await app.request(`${origin}/register`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: `${handle}@example.test`,
        password: 'test-password-123',
        display_name: handle,
        handle,
        school: '',
        department: '',
        grade: '',
      }),
    });
    cookies[handle] = res.headers.get('set-cookie')!.split(';')[0];
    ids[handle] = (
      store.db.query('SELECT id FROM users WHERE handle=?').get(handle) as { id: string }
    ).id;
  }
  return { app, origin, cookies, ids };
}
const suggest = (store: Store, user: string, id: string, url: string, title = '候補') =>
  store.db
    .query(
      'INSERT INTO event_suggestions(id,user_id,run_id,url,data,created_at) VALUES(?,?,?,?,?,?)',
    )
    .run(
      id,
      user,
      'r',
      url,
      JSON.stringify({
        title,
        url,
        date: '',
        deadline: '',
        location: '',
        format: 'unknown',
        kind: 'hackathon',
        audience: '',
        reason: '理由です。',
        role: '',
        work_ids: [],
        work_titles: [],
        confidence: 'high',
        source_domain: new URL(url).hostname,
      }),
      new Date().toISOString(),
    );

test('画像は本人だけが取得でき、Cache-ControlはprivateでSVGにはCSPが付く', async () => {
  const store = new Store();
  try {
    const previews = previewsFor(store);
    const { app, origin, cookies, ids } = await appWith(store, previews);
    suggest(store, ids.alice, 's1', 'https://ev.test/event');
    suggest(store, ids.alice, 's2', 'https://ev.test/svgpage');
    previews.ensure(['https://ev.test/event', 'https://ev.test/svgpage']);
    await previews.idle();
    const row = previews.get('https://ev.test/event')!;
    const get = (id: string, who?: string) =>
      app.request(`${origin}/event-previews/${id}`, {
        headers: who ? { Cookie: cookies[who] } : {},
      });
    expect((await get(row.image_id!)).status).toBe(401);
    expect((await get(row.image_id!, 'bob')).status).toBe(404);
    expect((await get('00000000-0000-0000-0000-000000000000', 'alice')).status).toBe(404);
    expect((await get('../../etc/passwd', 'alice')).status).toBe(404);
    const ok = await get(row.image_id!, 'alice');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('cache-control')).toStartWith('private');
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(png);
    expect((await get(row.icon_id!, 'alice')).headers.get('content-type')).toBe('image/x-icon');
    const logo = await get(previews.get('https://ev.test/svgpage')!.image_id!, 'alice');
    expect(logo.headers.get('content-type')).toBe('image/svg+xml');
    expect(logo.headers.get('content-security-policy')).toContain("default-src 'none'");
    // Bob saves the same URL as his own opportunity and can then load it.
    new Opportunities(store).add(ids.bob, {
      title: '同じイベント',
      url: 'https://ev.test/event',
      date: '',
      deadline: '',
      location: '',
      conditions: '',
      existing_work: 'unknown',
    });
    expect((await get(row.image_id!, 'bob')).status).toBe(200);
  } finally {
    store.close();
  }
});

test('プレビューが無くても画面は壊れず、取得した文字列はエスケープされる', async () => {
  const store = new Store();
  try {
    const previews = previewsFor(store);
    const { app, origin, cookies, ids } = await appWith(store, previews);
    suggest(store, ids.alice, 's1', 'https://ev.test/xss', 'XSS候補');
    suggest(store, ids.alice, 's2', 'https://ev.test/missing', '取得できない候補');
    // The first view queues the fetch and does not wait for it.
    const first = await (
      await app.request(`${origin}/opportunities`, { headers: { Cookie: cookies.alice } })
    ).text();
    expect(first).toContain('XSS候補');
    expect(first).toContain('ev-thumb-empty');
    expect(first).toContain('ev.test');
    await previews.idle();
    const second = await (
      await app.request(`${origin}/opportunities`, { headers: { Cookie: cookies.alice } })
    ).text();
    expect(second).toContain('/event-previews/');
    expect(second).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(second).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(second).not.toContain('<script>alert(1)');
    expect(second).not.toContain('<img src=x');
    expect(second).toContain('取得できない候補');
    // Saved list, detail page and Home rail render with and without previews.
    const op = new Opportunities(store);
    const saved = await app.request(`${origin}/opportunities/suggestions/s1/save`, {
      method: 'POST',
      headers: { Cookie: cookies.alice, Origin: origin },
    });
    const detail = await (
      await app.request(`${origin}${saved.headers.get('location')}`, {
        headers: { Cookie: cookies.alice },
      })
    ).text();
    expect(detail).toContain('公式ページを開く');
    expect(detail).toContain('ev-link');
    expect(detail).not.toContain('<script>alert(1)');
    const tab = await (
      await app.request(`${origin}/opportunities?tab=saved`, { headers: { Cookie: cookies.alice } })
    ).text();
    expect(tab).toContain('XSS候補');
    expect(op.list(ids.alice)).toHaveLength(1);
    const home = await (
      await app.request(`${origin}/home`, { headers: { Cookie: cookies.alice } })
    ).text();
    expect(home).toContain('ev-rail-thumb');
    // No Previews configured at all
    const bare = await appWith(new Store());
    expect(
      (
        await bare.app.request(`${bare.origin}/event-previews/x`, {
          headers: { Cookie: bare.cookies.alice },
        })
      ).status,
    ).toBe(404);
  } finally {
    store.close();
  }
});

test('探索が候補を保存した後にプレビューを背景で取得する', async () => {
  const store = new Store();
  try {
    const user = await store.register({
      email: 'd@example.test',
      password: 'test-password-123',
      display_name: 'd',
      handle: 'disc',
      school: '',
      department: '',
      grade: '',
    });
    const previews = previewsFor(store);
    const url = 'https://ev.test/event';
    const candidate = {
      title: 'イベント',
      url,
      date: '',
      deadline: '',
      location: 'オンライン',
      format: 'online',
      kind: 'hackathon',
      audience: '高専生',
      reason: '経験が活きます。',
      work_titles: [],
      role: '開発',
      confidence: 'high',
    };
    const d = new Discovery(
      store,
      new Opportunities(store),
      {
        key: 'k',
        fetch: async () =>
          Response.json({
            stop_reason: 'end_turn',
            content: [
              {
                type: 'web_search_tool_result',
                content: [{ type: 'web_search_result', url, title: 't' }],
              },
              { type: 'text', text: JSON.stringify({ candidates: [candidate] }) },
            ],
            usage: {},
          }),
      },
      previews,
    );
    expect(await d.run(user.id)).not.toBeNull();
    expect(d.last(user.id)!.state).toBe('completed');
    await previews.idle();
    expect(previews.get(url)?.image_id).toBeTruthy();
  } finally {
    store.close();
  }
});
