import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app';
import { Store } from '../src/store';
import type { WorkData } from '../src/schema';

const origin = 'http://localhost:4177';
const work: WorkData = {
  title: '記憶ゲーム',
  summary: '光と音の記憶ゲームです。',
  kind: 'coursework',
  year: 2025,
  status: 'prototype',
  team_result: '',
  my_roles: ['回路設計'],
  my_contribution: '回路を設計しました。',
  ingenuity: '',
  outcome: '',
  next_interest: '',
  tags: [],
  asset_ids: [],
  sources: [],
};
let store: Store, app: ReturnType<typeof createApp>, dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kosen-direct-'));
  store = new Store();
  app = createApp(store, {
    origin,
    assetDirectory: dir,
    staticDirectory: resolve('public'),
    skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
  });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const form = (cookie: string, path: string, fields: Record<string, string>, from = origin) =>
  app.request(path, {
    method: 'POST',
    headers: { Origin: from, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
const page = async (cookie: string, path: string) =>
  (await app.request(path, { headers: { Cookie: cookie } })).text();
async function person(handle: string) {
  const r = await json('/v1/register', {
    email: `${handle}@example.test`,
    password: 'test-password-123',
    display_name: handle,
    handle,
  });
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const { token } = await (await json('/v1/tokens', { label: 't' }, { Cookie: cookie })).json();
  const { work: w } = await (
    await json('/v1/works', { source_key: 'w', work }, { Authorization: `Bearer ${token}` })
  ).json();
  await form(cookie, `/works/${w.id}/publish`, {
    revision: '1',
    reviewed: 'yes',
    share_to_feed: 'yes',
  });
  const id = (store.db.query('SELECT id FROM users WHERE handle=?').get(handle) as { id: string })
    .id;
  return { cookie, token, workId: w.id as string, id, handle };
}
const invite = (from: { cookie: string }, to: { workId: string }) =>
  form(from.cookie, `/social/works/${to.workId}/invitations`, {
    event_title: 'AI HACK 2026',
    event_url: 'https://aihackathon.jp/',
    purpose: '一緒に出たいです。',
    sender_role: '回路',
    recipient_role: 'Web',
    next_step: '30分話したいです。',
  });

test('受け入れる前は送れず、受け入れた二人だけが非公開で送り合える', async () => {
  const alice = await person('alice');
  const bob = await person('bobby');
  const carol = await person('carol');
  await invite(alice, bob);

  expect(await page(bob.cookie, '/connections?with=alice')).not.toContain(
    'action="/social/direct/alice"',
  );
  expect((await form(alice.cookie, '/social/direct/bobby', { body: 'まだ' })).status).toBe(403);

  const id = (store.db.query('SELECT id FROM social_invitations').get() as { id: string }).id;
  await form(bob.cookie, `/social/invitations/${id}/state`, { state: 'accepted' });
  expect(await page(bob.cookie, '/connections?with=alice')).toContain(
    'action="/social/direct/alice"',
  );
  const sent = await form(alice.cookie, '/social/direct/bobby', {
    body: '<b>よろしく</b>お願いします',
    back: '/connections?with=bobby',
  });
  expect(sent.status).toBe(303);
  expect(sent.headers.get('location')).toBe('/connections?with=bobby');
  const bobView = await page(bob.cookie, '/connections?with=alice');
  expect(bobView).toContain('&lt;b&gt;よろしく&lt;/b&gt;お願いします');
  expect(bobView).toContain('二人にだけ表示されます');
  await form(bob.cookie, '/social/direct/alice', { body: '了解です' });
  expect(await page(alice.cookie, '/connections?with=bobby')).toContain('了解です');
  expect(await page(bob.cookie, '/connections?tab=notifications')).toContain(
    'aliceさんからメッセージが届きました。',
  );
  expect(await page(carol.cookie, '/connections')).not.toContain('お願いします');
  expect((await form(carol.cookie, '/social/direct/alice', { body: '割り込み' })).status).toBe(403);
  expect(await page(alice.cookie, '/u/bobby')).not.toContain('了解です');
});

test('ブロック後・連携トークン・別のOriginからは送れない', async () => {
  const alice = await person('alice');
  const bob = await person('bobby');
  await invite(alice, bob);
  const id = (store.db.query('SELECT id FROM social_invitations').get() as { id: string }).id;
  await form(bob.cookie, `/social/invitations/${id}/state`, { state: 'accepted' });
  const bearer = await app.request('/social/direct/bobby', {
    method: 'POST',
    headers: {
      Origin: origin,
      Authorization: `Bearer ${alice.token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ body: 'エージェントから' }),
  });
  expect(bearer.status).toBe(403);
  expect(
    (await form(alice.cookie, '/social/direct/bobby', { body: 'x' }, 'https://evil.example'))
      .status,
  ).toBe(403);
  await form(bob.cookie, `/social/blocks/${alice.id}`, {});
  expect((await form(alice.cookie, '/social/direct/bobby', { body: 'ブロック後' })).status).toBe(
    403,
  );
});
