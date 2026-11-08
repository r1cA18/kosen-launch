import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app';
import { Store } from '../src/store';
import { urlKey } from '../src/opportunities';
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
  dir = mkdtempSync(join(tmpdir(), 'kosen-interest-'));
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
const form = (cookie: string, path: string, fields: Record<string, string>) =>
  app.request(path, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fields),
  });
const page = async (cookie: string, path: string) =>
  (await app.request(path, { headers: { Cookie: cookie } })).text();
async function person(handle: string, url: string) {
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
  const saved = await form(cookie, '/opportunities', {
    title: 'AI HACK 2026',
    url,
    date: '2026-12-11',
    deadline: '2026-12-09',
    location: 'オンライン',
    conditions: '',
    existing_work: 'unknown',
  });
  const id = saved.headers.get('location')!.split('/').pop()!;
  const user = (store.db.query('SELECT id FROM users WHERE handle=?').get(handle) as { id: string })
    .id;
  return { cookie, id, workId: w.id as string, user };
}

test('URLの表記揺れは同じイベントとして扱う', () => {
  expect(urlKey('https://www.aihackathon.jp/?ref=x#top')).toBe(urlKey('http://aihackathon.jp'));
  expect(urlKey('https://example.com/a/')).not.toBe(urlKey('https://example.com/b'));
});

test('検討中と表示した人だけが互いに見え、役割付きの誘いを送れる', async () => {
  const me = await person('meuser', 'https://aihackathon.jp/');
  const peer = await person('peer', 'https://www.aihackathon.jp');
  const quiet = await person('quiet', 'https://aihackathon.jp/');

  expect(await page(me.cookie, `/opportunities/${me.id}`)).toContain('検討中の人 0人');
  await form(peer.cookie, `/opportunities/${peer.id}/share`, { share: 'yes' });
  const html = await page(me.cookie, `/opportunities/${me.id}`);
  expect(html).toContain('検討中の人 1人');
  expect(html).toContain('@peer');
  expect(html).not.toContain('@quiet');
  expect(html).toContain(`/social/works/${peer.workId}/invitations`);

  const sent = await form(me.cookie, `/social/works/${peer.workId}/invitations`, {
    event_title: 'AI HACK 2026',
    event_url: 'https://aihackathon.jp/',
    purpose: '同じイベントを検討しています。',
    sender_role: '回路設計',
    recipient_role: '回路設計',
    next_step: '30分話したいです。',
  });
  expect(sent.status).toBe(303);
  expect(await page(peer.cookie, '/connections')).toContain('AI HACK 2026');

  await form(peer.cookie, `/opportunities/${peer.id}/share`, { share: 'no' });
  expect(await page(me.cookie, `/opportunities/${me.id}`)).not.toContain('@peer');

  await form(peer.cookie, `/opportunities/${peer.id}/share`, { share: 'yes' });
  await form(me.cookie, `/social/blocks/${peer.user}`, {});
  expect(await page(me.cookie, `/opportunities/${me.id}`)).not.toContain('@peer');
  expect(quiet.id).toBeTruthy();
});

test('他人の機会の共有は切り替えられない', async () => {
  const me = await person('meuser', 'https://aihackathon.jp/');
  const other = await person('other', 'https://aihackathon.jp/');
  const denied = await form(other.cookie, `/opportunities/${me.id}/share`, { share: 'yes' });
  expect(denied.status).toBe(404);
});
