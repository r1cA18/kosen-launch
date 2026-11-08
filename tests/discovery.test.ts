import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { Store } from '../src/store';
import { Opportunities } from '../src/opportunities';
import { Discovery, isListing, urlKey } from '../src/discovery';
import { SocialStore } from '../src/social';
import { createApp } from '../src/app';
import { workSchema } from '../src/schema';

const future = (days: number) =>
  new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const work = (title: string, tags: string[]) =>
  workSchema.parse({
    title,
    summary: `${title}の概要です。`,
    kind: 'coursework',
    year: 2025,
    status: 'completed',
    team_result: '',
    my_roles: ['回路設計'],
    my_contribution: '回路を担当しました。',
    ingenuity: '',
    outcome: '',
    next_interest: '',
    tags,
    asset_ids: [],
    sources: [{ label: 'PRIVATE_SOURCE', note: 'PRIVATE_NOTE' }],
    assessment: { basis: 'unknown', evidence: 'PRIVATE_EVIDENCE', uncertainties: [] },
  });
async function setup() {
  const store = new Store();
  const user = await store.register({
    email: 'private-mail@example.test',
    password: 'test-password-123',
    display_name: 'PRIVATE_NAME',
    handle: 'private-handle',
    school: 'PRIVATE_SCHOOL',
    department: 'PRIVATE_DEPT',
    grade: 'PRIVATE_GRADE',
  });
  store.updateProfile(user.id, {
    bio: '電子工作とWebが好きです。',
    avatar_asset_id: null,
    interests: ['電子工作', 'UIデザイン'],
    links: [{ label: 'PRIVATE_LINK', url: 'https://private.example.test' }],
  });
  const game = store.createWork(user.id, 'game', work('記憶ゲーム', ['Arduino'])).work;
  return { store, user, game };
}
const candidate = (over: Record<string, unknown> = {}) => ({
  title: '高専ものづくりハッカソン',
  url: 'https://hack.example.test/2026',
  date: future(30),
  deadline: future(10),
  location: '東京',
  format: 'offline',
  kind: 'hackathon',
  audience: '高専生',
  reason: '記憶ゲームの回路設計の経験が活きます。',
  work_titles: ['記憶ゲーム'],
  role: '回路設計',
  confidence: 'high',
  ...over,
});
/** Fake Messages API answer: one web search result block and the structured text. */
function reply(candidates: unknown[], urls: string[]) {
  return Response.json({
    stop_reason: 'end_turn',
    content: [
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 's1',
        content: urls.map((url) => ({ type: 'web_search_result', url, title: 't' })),
      },
      { type: 'text', text: JSON.stringify({ candidates }) },
    ],
    usage: { input_tokens: 900, output_tokens: 300, server_tool_use: { web_search_requests: 2 } },
  });
}

test('検索結果に出たURLだけ採用し、期限切れと不明な作品を除き通知を作る', async () => {
  const { store, user, game } = await setup();
  const bodies: string[] = [];
  try {
    const op = new Opportunities(store);
    const d = new Discovery(store, op, {
      key: 'test-key',
      fetch: async (_url, init) => {
        bodies.push(String(init.body));
        return reply(
          [
            candidate({ url: 'https://www.hack.example.test/2026/' }),
            candidate({ title: '捏造', url: 'https://invented.example.test/event' }),
            candidate({
              title: '期限切れ',
              url: 'https://old.example.test/',
              deadline: '2020-01-01',
            }),
            candidate({
              title: '作品不明',
              url: 'https://other.example.test/x',
              work_titles: ['存在しない作品'],
            }),
            { title: '形式違反' },
          ],
          [
            'https://hack.example.test/2026?ref=search',
            'https://old.example.test/',
            'https://other.example.test/x',
          ],
        );
      },
    });
    expect(await d.run(user.id)).not.toBeNull();
    const items = op.suggestions(user.id);
    expect(items.map((s) => s.title)).toEqual(['高専ものづくりハッカソン']);
    expect(items[0].work_ids).toEqual([game.id]);
    expect(items[0].source_domain).toBe('hack.example.test');
    expect(items[0].found_via).toBe('web_search');
    const body = JSON.parse(bodies[0]);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools[0]).toMatchObject({ name: 'web_search', max_uses: 5 });
    expect(body.output_config.format.type).toBe('json_schema');
    const run = d.last(user.id)!;
    expect(run).toMatchObject({ state: 'completed', found: 4, added: 1, input_tokens: 900 });
    expect(run.search_requests).toBe(2);
    const notices = new SocialStore(store).notices(user.id);
    expect(notices[0]).toMatchObject({ message: 'あなた向けのイベントが1件届きました。', read: 0 });
    expect(op.forYou(user.id, 3)).toHaveLength(1);
  } finally {
    store.close();
  }
});

test('Claudeへの入力に氏名・学校・連絡先・根拠メモを含めない', async () => {
  const { store, user } = await setup();
  let sent = '';
  try {
    const d = new Discovery(store, new Opportunities(store), {
      key: 'test-key',
      fetch: async (_u, init) => {
        sent = String(init.body);
        return reply([], []);
      },
    });
    await d.run(user.id);
    for (const secret of ['PRIVATE_', 'private-mail', 'private-handle', 'private.example'])
      expect(sent).not.toContain(secret);
    const input = JSON.parse(JSON.parse(sent).messages[0].content);
    expect(input.profile).toEqual({
      interests: ['電子工作', 'UIデザイン'],
      bio: '電子工作とWebが好きです。',
    });
    expect(input.works[0]).toEqual({
      title: '記憶ゲーム',
      kind: 'coursework',
      status: 'completed',
      tags: ['Arduino'],
      my_roles: ['回路設計'],
    });
    expect(d.last(user.id)?.added).toBe(0);
    expect(new SocialStore(store).notices(user.id)).toHaveLength(0);
  } finally {
    store.close();
  }
});

test('24時間以内は再実行せず、時間が経てば再実行する。失敗も1回に数える', async () => {
  const { store, user } = await setup();
  let calls = 0,
    clock = Date.now();
  try {
    const d = new Discovery(store, new Opportunities(store), {
      key: 'test-key',
      now: () => clock,
      fetch: async () => {
        calls++;
        return new Response('down', { status: 529 });
      },
    });
    await d.run(user.id);
    expect(d.last(user.id)?.state).toBe('failed');
    expect(d.last(user.id)?.error).not.toContain('down');
    expect(await d.run(user.id)).toBeNull();
    expect(d.due(user.id)).toBe(false);
    clock += 25 * 3600000;
    expect(d.due(user.id)).toBe(true);
    await d.run(user.id);
    expect(calls).toBe(2);
  } finally {
    store.close();
  }
});

test('同じ人の探索は同時に1件だけ。画面からの起動も重複しない', async () => {
  const { store, user } = await setup();
  let calls = 0,
    release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  try {
    const d = new Discovery(store, new Opportunities(store), {
      key: 'test-key',
      fetch: async () => {
        calls++;
        await gate;
        return reply([], []);
      },
    });
    const first = d.run(user.id, true);
    expect(d.running(user.id)).toBe(true);
    expect(await d.run(user.id, true)).toBeNull();
    d.ensure(user.id);
    await d.tick();
    release();
    await first;
    expect(calls).toBe(1);
    expect(d.running(user.id)).toBe(false);
  } finally {
    release();
    store.close();
  }
});

test('興味なしは一覧から消え、次回の入力に渡り、同じURLを再提案しない', async () => {
  const { store, user } = await setup();
  const bodies: string[] = [];
  try {
    const op = new Opportunities(store);
    const d = new Discovery(store, op, {
      key: 'test-key',
      fetch: async (_u, init) => {
        bodies.push(String(init.body));
        return reply([candidate()], ['https://hack.example.test/2026']);
      },
    });
    await d.run(user.id);
    const [s] = op.suggestions(user.id);
    op.dismissSuggestion(user.id, s.id);
    expect(op.suggestions(user.id)).toHaveLength(0);
    await d.run(user.id, true);
    const input = JSON.parse(JSON.parse(bodies[1]).messages[0].content);
    expect(input.feedback.not_interested).toEqual([
      { title: '高専ものづくりハッカソン', kind: 'hackathon', domain: 'hack.example.test' },
    ]);
    expect(d.last(user.id)?.added).toBe(0);
    expect(op.suggestions(user.id)).toHaveLength(0);
  } finally {
    store.close();
  }
});

test('キーが無ければ探索もスケジューラーも何もしない', async () => {
  const { store, user } = await setup();
  let calls = 0;
  try {
    const d = new Discovery(store, new Opportunities(store), {
      fetch: async () => {
        calls++;
        return reply([], []);
      },
    });
    store.session(user.id);
    expect(d.enabled()).toBe(false);
    expect(d.due(user.id)).toBe(false);
    expect(await d.run(user.id, true)).toBeNull();
    d.ensure(user.id);
    await d.tick();
    d.start()();
    expect(calls).toBe(0);
    expect(d.last(user.id)).toBeNull();
  } finally {
    store.close();
  }
});

test('スケジューラーは14日以内にログインした人だけを対象にする', async () => {
  const { store, user } = await setup();
  const other = await store.register({
    email: 'other@example.test',
    password: 'test-password-123',
    display_name: 'Other',
    handle: 'other-user',
    school: '',
    department: '',
    grade: '',
  });
  let calls = 0;
  try {
    store.session(user.id);
    store.db
      .query('INSERT INTO sessions VALUES(?,?,?)')
      .run('old', other.id, Date.now() - 8 * 86400000);
    const d = new Discovery(store, new Opportunities(store), {
      key: 'test-key',
      fetch: async () => {
        calls++;
        return reply([], []);
      },
    });
    expect(d.activeUsers()).toEqual([user.id]);
    await d.tick();
    await d.tick();
    expect(calls).toBe(1);
  } finally {
    store.close();
  }
});

test('RUSTXNG_URLがあればRustXNGの結果から選ばせ、その結果のURLだけ採用する', async () => {
  const { store, user } = await setup();
  const queries: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== '/search' || url.searchParams.get('format') !== 'json')
        return new Response('not found', { status: 404 });
      queries.push(url.searchParams.get('q')!);
      return Response.json({
        results: [
          {
            title: 'UIデザインコンテスト',
            url: 'https://ui.example.test/contest',
            snippet: '学生向け',
          },
        ],
      });
    },
  });
  let sent: Record<string, unknown> = {};
  try {
    const op = new Opportunities(store);
    const d = new Discovery(store, op, {
      key: 'test-key',
      rustxng: `http://127.0.0.1:${server.port}`,
      fetch: async (_u, init) => {
        sent = JSON.parse(String(init.body));
        return Response.json({
          stop_reason: 'end_turn',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                candidates: [
                  candidate({
                    title: 'UIデザインコンテスト',
                    url: 'https://ui.example.test/contest',
                  }),
                  candidate({ title: '捏造', url: 'https://invented.example.test/' }),
                ],
              }),
            },
          ],
          usage: { input_tokens: 400, output_tokens: 100 },
        });
      },
    });
    await d.run(user.id);
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.join(' ')).toContain('電子工作');
    expect(queries.join(' ')).not.toContain('PRIVATE');
    expect(sent.tools).toBeUndefined();
    expect(String((sent.messages as { content: string }[])[0].content)).toContain(
      'ui.example.test/contest',
    );
    const items = op.suggestions(user.id);
    expect(items.map((s) => s.title)).toEqual(['UIデザインコンテスト']);
    expect(items[0].found_via).toBe('rustxng');
    expect(d.last(user.id)).toMatchObject({ source: 'rustxng', state: 'completed' });
  } finally {
    server.stop(true);
    store.close();
  }
});

test('URLの比較はホストとパスで行い、資格情報付きや非HTTPと一覧ページを拒否する', () => {
  expect(urlKey('https://www.Example.test/a/?x=1#y')).toBe('example.test/a');
  expect(urlKey('javascript:alert(1)')).toBeNull();
  expect(urlKey('https://user:pw@example.test/')).toBeNull();
  expect(isListing('https://dle.or.jp/contests/category/programming/')).toBe(true);
  expect(isListing('https://job.example.test/job_search/kw/x/')).toBe(true);
  expect(isListing('https://aihackathon.jp/')).toBe(false);
});

test('Events画面に候補を表示し、保存すると準備案のある詳細へ移り、興味なしで消える', async () => {
  const store = new Store();
  const origin = 'http://127.0.0.1:4177';
  const app = createApp(store, {
    origin,
    assetDirectory: resolve('.data/test-assets'),
    staticDirectory: resolve('public'),
    skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
  });
  try {
    const registered = await app.request(`${origin}/register`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: 'events@example.test',
        password: 'test-password-123',
        display_name: 'Events',
        handle: 'events-user',
        school: '',
        department: '',
        grade: '',
      }),
    });
    const cookie = registered.headers.get('set-cookie')!.split(';')[0];
    const user = store.db.query("SELECT id FROM users WHERE handle='events-user'").get() as {
      id: string;
    };
    const op = new Opportunities(store);
    for (const [id, url] of [
      ['s1', 'https://hack.example.test/a'],
      ['s2', 'https://hack.example.test/b'],
    ])
      store.db
        .query(
          'INSERT INTO event_suggestions(id,user_id,run_id,url,data,created_at) VALUES(?,?,?,?,?,?)',
        )
        .run(
          id,
          user.id,
          'r',
          url,
          JSON.stringify({
            ...candidate({ title: `候補${id}`, url }),
            work_ids: [],
            source_domain: 'hack.example.test',
          }),
          new Date().toISOString(),
        );
    const page = await (
      await app.request(`${origin}/opportunities`, { headers: { Cookie: cookie } })
    ).text();
    expect(page).toContain('<h1>Events</h1>');
    expect(page).toContain('候補s1');
    expect(page).toContain('あなたに合う理由');
    expect(page).toContain('AIの接続が設定されていない');
    const headers = { Cookie: cookie, Origin: origin };
    const saved = await app.request(`${origin}/opportunities/suggestions/s1/save`, {
      method: 'POST',
      headers,
    });
    expect(saved.status).toBe(303);
    const detail = await (
      await app.request(`${origin}${saved.headers.get('location')}`, { headers })
    ).text();
    expect(detail).toContain('準備案');
    expect(detail).toContain('候補s1');
    await app.request(`${origin}/opportunities/suggestions/s2/dismiss`, {
      method: 'POST',
      headers,
    });
    expect(op.suggestions(user.id)).toHaveLength(0);
    const tab = await (
      await app.request(`${origin}/opportunities?tab=saved`, { headers: { Cookie: cookie } })
    ).text();
    expect(tab).toContain('候補s1');
    expect(op.forYou(user.id)).toHaveLength(0);
  } finally {
    store.close();
  }
});
