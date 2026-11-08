import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store, type User } from '../src/store';
import { SocialStore } from '../src/social';
import { TimelineStore } from '../src/timeline';
import { createApp } from '../src/app';
import { workSchema } from '../src/schema';

let store: Store, social: SocialStore, tl: TimelineStore, app: ReturnType<typeof createApp>;
let dir: string, owner: User, peer: User, third: User, workId: string, peerWork: string;
const origin = 'http://localhost:4177';
const input = workSchema.parse({
  title: '回路制作',
  summary: '記憶ゲームです。',
  kind: 'coursework',
  year: null,
  status: 'prototype',
  team_result: '',
  my_roles: ['制御'],
  my_contribution: '回路を試作しました。',
  ingenuity: '',
  outcome: '',
  next_interest: '',
  tags: [],
  asset_ids: [],
  sources: [{ label: 'PRIVATE_SOURCE', note: 'PRIVATE_NOTE' }],
  assessment: { basis: 'inferred', evidence: 'PRIVATE_EVIDENCE', uncertainties: [] },
});
async function register(handle: string) {
  return store.register({
    email: `${handle}@example.test`,
    password: 'test-password-123',
    display_name: handle,
    handle,
    school: 'PRIVATE_SCHOOL',
    department: '',
    grade: '',
  });
}
function form(
  user: User,
  path: string,
  body: Record<string, string>,
  override: Record<string, string> = {},
) {
  return app.request(path, {
    method: 'POST',
    headers: { Origin: origin, Cookie: `kl_session=${store.session(user.id)}`, ...override },
    body: new URLSearchParams(body),
  });
}
const get = (user: User, path: string) =>
  app.request(path, { headers: { Cookie: `kl_session=${store.session(user.id)}` } });
const recruit = {
  kind: 'recruit',
  title: 'LTイベントのチーム',
  body: '展示を一緒につくる人を探しています。',
  roles: 'UI、回路',
  url: 'https://example.test/recruit',
  deadline: '2099-01-01',
};
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kosen-timeline-'));
  store = new Store(join(dir, 'db.sqlite'));
  social = new SocialStore(store);
  tl = new TimelineStore(store, social);
  app = createApp(store, {
    origin,
    assetDirectory: dir,
    staticDirectory: resolve('public'),
    skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
  });
  owner = await register('owner');
  peer = await register('peer');
  third = await register('third');
  workId = store.createWork(owner.id, 'circuit', input).work.id;
  store.publish(owner.id, workId, 1, true);
  peerWork = store.createWork(peer.id, 'ui', input).work.id;
  store.publish(peer.id, peerWork, 1, false);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test('進捗と仲間募集を投稿。種類と役割で絞り込み。共有イベントも表示', async () => {
  expect(
    (
      await form(owner, '/timeline/posts', {
        kind: 'progress',
        body: '配線が終わりました。',
        work_id: workId,
      })
    ).status,
  ).toBe(303);
  expect((await form(peer, '/timeline/posts', recruit)).status).toBe(303);
  expect(
    (await form(owner, '/timeline/posts', { kind: 'progress', body: 'x'.repeat(281) })).status,
  ).toBe(422);
  expect(
    (await form(owner, '/timeline/posts', { kind: 'progress', body: 'a', work_id: peerWork }))
      .status,
  ).toBe(422);
  expect(
    (await form(owner, '/timeline/posts', { ...recruit, url: 'javascript:alert(1)' })).status,
  ).toBe(422);
  expect(
    (await form(owner, '/timeline/posts', { ...recruit, deadline: '2000-01-01' })).status,
  ).toBe(422);
  const all = await (await get(third, '/home?filter=all')).text();
  expect(all).toContain('配線が終わりました。');
  expect(all).toContain('LTイベントのチーム');
  expect(all).toContain('作品の共有');
  expect(all).toContain('回路制作');
  const only = await (await get(third, '/home?filter=recruit')).text();
  expect(only).toContain('LTイベントのチーム');
  expect(only).not.toContain('配線が終わりました。');
  expect(only).not.toContain('作品の共有');
  expect(await (await get(third, '/home?role=UI')).text()).toContain('LTイベントのチーム');
  expect(await (await get(third, '/home?role=%E7%99%BA%E8%A1%A8')).text()).not.toContain(
    'LTイベントのチーム',
  );
});

test('作品の埋め込みは公開停止で消える', async () => {
  await form(owner, '/timeline/posts', { kind: 'progress', body: '進捗です。', work_id: workId });
  store.publish(owner.id, workId, 1, false);
  expect(await (await get(third, '/home?filter=all')).text()).toContain('tl-embed');
  store.withdraw(owner.id, workId);
  const html = await (await get(third, '/home?filter=all')).text();
  expect(html).toContain('進捗です。');
  expect(html).not.toContain('tl-embed');
  expect(html).not.toContain('回路制作');
});

test('気になると返信とスレッド。返信への返信は不可。通知に入る', async () => {
  const id = tl.progress(owner.id, { body: '進捗です。' });
  await form(peer, `/timeline/${id}/like`, {});
  await form(third, `/timeline/${id}/like`, {});
  expect(tl.post(id, peer.id).likes).toBe(2);
  await form(peer, `/timeline/${id}/like`, {});
  expect(tl.post(id, peer.id).likes).toBe(1);
  expect(
    (
      await form(peer, `/timeline/${id}/replies`, {
        body: '詳しく聞きたいです <script>alert(1)</script>',
      })
    ).status,
  ).toBe(303);
  const reply = tl.replies(id, peer.id)[0];
  expect((await form(owner, `/timeline/${reply.id}/replies`, { body: 'x' })).status).toBe(422);
  expect(social.notices(owner.id).filter((n) => !n.read)).toHaveLength(1);
  const html = await (await get(owner, `/timeline/${id}`)).text();
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>alert');
  expect((await get(owner, `/timeline/${reply.id}`)).status).toBe(404);
});

test('参加希望から受け入れと連絡先共有まで', async () => {
  const id = tl.recruit(owner.id, {
    title: '募集',
    body: '仲間を探します。',
    roles: ['UI'],
    deadline: '2099-01-01',
  });
  expect((await form(owner, `/timeline/${id}/joins`, { role: 'UI', message: 'self' })).status).toBe(
    422,
  );
  expect(
    (
      await form(peer, `/timeline/${id}/joins`, {
        role: 'UI設計',
        message: '参加したいです。',
        work_id: workId,
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await form(peer, `/timeline/${id}/joins`, {
        role: 'UI設計',
        message: '参加したいです。',
        work_id: peerWork,
      })
    ).status,
  ).toBe(303);
  expect(
    (await form(peer, `/timeline/${id}/joins`, { role: 'UI設計', message: '二重' })).status,
  ).toBe(409);
  const join = tl.joins(id, owner.id)[0];
  expect(social.notices(owner.id).some((n) => n.message.includes('参加希望'))).toBe(true);
  expect(tl.joins(id, third.id)).toHaveLength(0);
  expect((await form(peer, `/timeline/joins/${join.id}/state`, { state: 'accepted' })).status).toBe(
    403,
  );
  expect(
    (await form(third, `/timeline/joins/${join.id}/state`, { state: 'accepted' })).status,
  ).toBe(404);
  expect(
    (await form(peer, `/timeline/joins/${join.id}/contact`, { contact: 'https://example.test/p' }))
      .status,
  ).toBe(409);
  expect(
    (await form(owner, `/timeline/joins/${join.id}/state`, { state: 'accepted' })).status,
  ).toBe(303);
  expect(social.notices(peer.id).some((n) => n.message.includes('受け入れ'))).toBe(true);
  expect(
    (await form(peer, `/timeline/joins/${join.id}/contact`, { contact: 'javascript:alert(1)' }))
      .status,
  ).toBe(422);
  await form(peer, `/timeline/joins/${join.id}/contact`, { contact: 'https://example.test/p' });
  await form(owner, `/timeline/joins/${join.id}/contact`, { contact: 'https://example.test/o' });
  expect(await (await get(owner, `/timeline/${id}`)).text()).toContain('https://example.test/p');
  expect(await (await get(peer, `/timeline/${id}`)).text()).toContain('https://example.test/o');
  expect(await (await get(third, `/timeline/${id}`)).text()).not.toContain('example.test/p');
  social.block(owner.id, peer.id);
  expect(tl.joins(id, owner.id)).toHaveLength(0);
  social.unblock(owner.id, peer.id);
  expect(tl.joins(id, owner.id)[0].state).toBe('cancelled');
  expect(tl.joins(id, owner.id)[0].applicant_contact).toBe('');
});

test('締切後の募集には参加希望を送れない', () => {
  const id = tl.recruit(owner.id, {
    title: '募集',
    body: '本文',
    roles: ['UI'],
    deadline: '2099-01-01',
  });
  store.db
    .query("UPDATE timeline_posts SET data=json_set(data,'$.deadline','2000-01-01') WHERE id=?")
    .run(id);
  expect(() => tl.join(peer.id, id, { role: 'UI', message: 'お願いします' })).toThrow();
});

test('削除は作者のみ。通報とブロックは本人の画面から隠す', async () => {
  const id = tl.progress(owner.id, { body: '消せない投稿' });
  expect((await form(peer, `/timeline/${id}/delete`, {})).status).toBe(403);
  expect(tl.post(id, peer.id).id).toBe(id);
  await form(peer, `/timeline/${id}/report`, { reason: '不適切' });
  expect(await (await get(peer, '/home?filter=all')).text()).not.toContain('消せない投稿');
  expect(await (await get(third, '/home?filter=all')).text()).toContain('消せない投稿');
  const id2 = tl.progress(owner.id, { body: 'ブロック対象' });
  await form(third, `/social/blocks/${owner.id}`, {});
  expect(await (await get(third, '/home?filter=all')).text()).not.toContain('ブロック対象');
  expect((await get(third, `/timeline/${id2}`)).status).toBe(404);
  expect((await form(owner, `/timeline/${id}/delete`, {})).status).toBe(303);
  expect(() => tl.post(id, owner.id)).toThrow();
  const r = tl.reply(peer.id, id2, '返信');
  tl.remove(owner.id, r);
  expect(tl.replies(id2, owner.id)).toHaveLength(0);
});

test('Bearerと別Originとログインなしは投稿できない', async () => {
  const token = store.createToken(peer.id, 'agent').token;
  const body = { kind: 'progress', body: 'agent' };
  expect(
    (await form(peer, '/timeline/posts', body, { Authorization: `Bearer ${token}` })).status,
  ).toBe(403);
  expect((await form(peer, '/timeline/posts', body, { Origin: 'https://evil.test' })).status).toBe(
    403,
  );
  expect(
    (
      await app.request('/timeline/posts', {
        method: 'POST',
        headers: { Origin: origin },
        body: new URLSearchParams(body),
      })
    ).status,
  ).toBe(401);
  const id = tl.progress(owner.id, { body: '進捗' });
  for (const path of [`/timeline/${id}/replies`, `/timeline/${id}/like`, `/timeline/${id}/joins`])
    expect(
      (await form(peer, path, { body: 'x' }, { Authorization: `Bearer ${token}` })).status,
    ).toBe(403);
  expect(tl.feed(peer.id, 'all').some((i) => i.type === 'post' && i.post.body === 'agent')).toBe(
    false,
  );
});

test('投稿本文はエスケープされ高い頻度は拒否', async () => {
  await form(owner, '/timeline/posts', { ...recruit, title: '<img src=x onerror=alert(1)>' });
  const html = await (await get(third, '/home?filter=all')).text();
  expect(html).toContain('&lt;img');
  expect(html).not.toContain('<img src=x');
  for (let i = 0; i < 29; i++) tl.progress(owner.id, { body: `n${i}` });
  expect(() => tl.progress(owner.id, { body: 'over' })).toThrow();
});
