import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store, type User } from '../src/store';
import { SocialStore } from '../src/social';
import { TimelineStore } from '../src/timeline';
import { createApp } from '../src/app';
import { workSchema } from '../src/schema';
import { ago } from '../src/timeline-ui';

let store: Store, social: SocialStore, tl: TimelineStore, app: ReturnType<typeof createApp>;
let dir: string, owner: User, peer: User, third: User, workId: string, peerWork: string;
const origin = 'http://localhost:4177';
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
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
const invitation = {
  event_title: '制作物を紹介するLT',
  event_url: 'https://example.test/event',
  purpose: '回路とUIの経験を組み合わせて展示したいです。',
  sender_role: 'UIと発表',
  recipient_role: '回路制御',
  next_step: '日曜に題材を相談します。',
};
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
const cookie = (user: User) => `kl_session=${store.session(user.id)}`;
function post(
  user: User,
  path: string,
  body: Record<string, string> | FormData,
  override: Record<string, string> = {},
) {
  return app.request(path, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie(user), ...override },
    body: body instanceof FormData ? body : new URLSearchParams(body),
  });
}
const get = (user: User, path: string) => app.request(path, { headers: { Cookie: cookie(user) } });
function profileForm(fields: Record<string, string>, avatar?: Uint8Array<ArrayBuffer>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  if (avatar) data.set('avatar', new File([avatar], 'icon.png', { type: 'image/png' }));
  return data;
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kosen-social-x-'));
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
  store.publish(peer.id, peerWork, 1, true);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test('Settingsでプロフィールと表示名とアイコンを保存し公開ページに表示', async () => {
  expect(await (await get(owner, '/home')).text()).toContain('関心を設定してください');
  const saved = await post(
    owner,
    '/settings/profile',
    profileForm(
      {
        display_name: '高専 太郎',
        bio: '回路と<script>alert(1)</script>UIを作っています。',
        interests: '電子工作、UI設計、電子工作',
        link_label_0: 'GitHub',
        link_url_0: 'https://github.com/example',
      },
      png,
    ),
  );
  expect(saved.status).toBe(303);
  expect(saved.headers.get('location')).toBe('/settings?saved=1');
  const profile = store.profileOf(owner.id);
  expect(profile.interests).toEqual(['電子工作', 'UI設計']);
  expect(profile.links).toEqual([{ label: 'GitHub', url: 'https://github.com/example' }]);
  expect(store.user(owner.id).display_name).toBe('高専 太郎');
  expect(profile.avatar_asset_id).toBeTruthy();
  const icon = await app.request(`/assets/${profile.avatar_asset_id}`);
  expect(icon.status).toBe(200);
  expect(icon.headers.get('content-type')).toBe('image/png');
  const page = await (await app.request('/u/owner')).text();
  expect(page).toContain('高専 太郎');
  expect(page).toContain('@owner');
  expect(page).toContain('電子工作');
  expect(page).toContain('https://github.com/example');
  expect(page).toContain(`/assets/${profile.avatar_asset_id}`);
  expect(page).toContain('&lt;script&gt;');
  expect(page).not.toContain('<script>alert');
  expect(page).not.toContain('PRIVATE_');
  expect(page).not.toContain('owner@example.test');
  expect(await (await get(owner, '/u/owner')).text()).toContain('プロフィールを編集');
  // Profiles no longer offer an open-ended message button.
  expect(await (await get(peer, '/u/owner')).text()).not.toContain('/connections?with=owner');
  expect(await (await get(owner, '/home')).text()).not.toContain('関心を設定してください');
  tl.progress(owner.id, { body: 'アイコン付きの投稿' });
  expect(await (await get(peer, '/home?filter=all')).text()).toContain(
    `/assets/${profile.avatar_asset_id}`,
  );
  const removed = await post(
    owner,
    '/settings/profile',
    profileForm({ display_name: '高専 太郎', bio: '', remove_avatar: 'yes' }),
  );
  expect(removed.status).toBe(303);
  expect(store.profileOf(owner.id).avatar_asset_id).toBeNull();
});

test('プロフィールは他人の画像と不正な入力を拒否', async () => {
  const assetId = store.addAsset(peer.id, 'image/png', join(dir, 'x'), 'peer');
  expect(() =>
    store.updateProfile(owner.id, {
      bio: '',
      avatar_asset_id: assetId,
      interests: [],
      links: [],
    }),
  ).toThrow('画像が見つかりません');
  for (const fields of <Record<string, string>[]>[
    { display_name: '' },
    { display_name: 'a', link_label_0: 'x', link_url_0: 'javascript:alert(1)' },
    { display_name: 'a', link_label_0: '', link_url_0: 'https://example.test' },
    { display_name: 'a', bio: 'x'.repeat(301) },
  ])
    expect((await post(owner, '/settings/profile', profileForm(fields))).status).toBe(422);
  expect(
    (
      await post(
        owner,
        '/settings/profile',
        profileForm({ display_name: 'a' }, new TextEncoder().encode('GIF89a')),
      )
    ).status,
  ).toBe(422);
  expect(store.user(owner.id).display_name).toBe('owner');
});

test('Settingsの各タブと旧URLのリダイレクト', async () => {
  const profile = await (await get(owner, '/settings')).text();
  expect(profile).toContain('name="display_name"');
  expect(profile).toContain('enctype="multipart/form-data"');
  expect(profile).toContain('aria-current="page"');
  const agent = await (await get(owner, '/settings?tab=agent')).text();
  expect(agent).toContain('連携トークンを作る');
  const account = await (await get(owner, '/settings?tab=account')).text();
  expect(account).toContain('owner@example.test');
  expect(account).toContain('action="/logout"');
  const old = await get(owner, '/settings/agents');
  expect(old.status).toBe(302);
  expect(old.headers.get('location')).toBe('/settings?tab=agent');
  const issued = await post(owner, '/settings/agents/tokens', { label: 'Claude Code' });
  expect(await issued.text()).toContain('klp_');
  const id = store.tokens(owner.id)[0].id;
  const revoked = await post(owner, `/settings/agents/tokens/${id}/revoke`, {});
  expect(revoked.headers.get('location')).toBe('/settings?tab=agent');
  expect((await app.request('/settings')).status).toBe(401);
});

test('Bearerと別Originは設定とメッセージを操作できない', async () => {
  const token = store.createToken(owner.id, 'agent').token;
  const bearer = { Authorization: `Bearer ${token}` };
  expect(
    (await post(owner, '/settings/profile', profileForm({ display_name: 'agent' }), bearer)).status,
  ).toBe(403);
  expect((await app.request('/settings', { headers: bearer })).status).toBe(403);
  expect((await app.request('/connections', { headers: bearer })).status).toBe(403);
  expect(
    (
      await post(owner, '/settings/profile', profileForm({ display_name: 'csrf' }), {
        Origin: 'https://evil.test',
      })
    ).status,
  ).toBe(403);
  expect(
    (await post(peer, '/social/questions', { work_id: workId, body: 'x' }, bearer)).status,
  ).toBe(403);
  expect(store.user(owner.id).display_name).toBe('owner');
});

test('Messagesは相手ごとに質問と誘いと参加希望をまとめ他人には見せない', async () => {
  const q = social.ask(peer.id, workId, '役割分担を<b>教えて</b>ください。');
  const recruit = tl.recruit(owner.id, {
    title: 'LTのチーム',
    body: '仲間を探します。',
    roles: ['UI'],
    deadline: '2099-01-01',
  });
  tl.join(peer.id, recruit, { role: 'UI', message: '参加したいです。' });
  social.invite(peer.id, workId, invitation);
  const list = tl.conversations(owner.id);
  expect(list).toHaveLength(1);
  expect(list[0].person.handle).toBe('peer');
  expect(list[0].unread).toBe(true);
  expect(list[0].count).toBe(3);
  // Items created in the same millisecond have no defined order, so compare as a set.
  expect(
    tl
      .thread(owner.id, peer.id)
      .map((m) => m.type)
      .sort(),
  ).toEqual(['invitation', 'join', 'question']);
  expect(tl.conversations(third.id)).toHaveLength(0);
  expect(tl.thread(third.id, peer.id)).toHaveLength(0);

  const listHtml = await (await get(owner, '/connections')).text();
  expect(listHtml).toContain('/connections?with=peer');
  // The newest conversation opens by default.
  expect(listHtml).toContain('&lt;b&gt;教えて');
  const html = await (await get(owner, '/connections?with=peer')).text();
  expect(html).toContain('&lt;b&gt;教えて');
  expect(html).toContain('制作物を紹介するLT');
  expect(html).toContain('参加したいです。');
  expect(html).toContain(`/social/questions/${q}/answer`);
  expect(social.notices(owner.id).every((n) => n.read)).toBe(true);

  const answered = await post(owner, `/social/questions/${q}/answer`, {
    answer: '回路を担当しました。',
    back: '/connections?with=peer',
  });
  expect(answered.headers.get('location')).toBe('/connections?with=peer');
  const peerView = await (await get(peer, '/connections?with=owner')).text();
  expect(peerView).toContain('回路を担当しました。');
  // Inbox does not offer an open-ended question form; new contact starts from events or recruits.
  expect(peerView).not.toContain('action="/social/questions"');
  const sent = await post(peer, '/social/questions', {
    work_id: workId,
    body: '続けて質問です。',
    back: '/connections?with=owner',
  });
  expect(sent.headers.get('location')).toBe('/connections?with=owner');
  expect(tl.openQuestion(owner.id, peer.id)?.body).toBe('続けて質問です。');
  const evil = await post(peer, '/social/questions', {
    work_id: workId,
    body: '外部へ',
    back: 'https://evil.test',
  });
  expect(evil.headers.get('location')).toBe('/connections');

  const inv = social.invitations(owner.id)[0];
  const decided = await post(owner, `/social/invitations/${inv.id}/state`, {
    state: 'accepted',
    back: '/connections?with=peer',
  });
  expect(decided.headers.get('location')).toBe('/connections?with=peer');
  expect(await (await get(owner, '/connections?with=peer')).text()).toContain('連絡先の共有');

  const thirdView = await (await get(third, '/connections?with=peer')).text();
  expect(thirdView).not.toContain('役割分担');
  expect(thirdView).not.toContain('制作物を紹介するLT');
  expect(thirdView).not.toContain('参加したいです。');

  social.block(owner.id, peer.id);
  expect(tl.conversations(owner.id).some((c) => c.person.id === peer.id)).toBe(false);
  expect(await (await get(owner, '/connections?with=peer')).text()).toContain('まだ届いていません');
});

test('通知タブは種類と送り手と時刻を表示し既読にできる', async () => {
  social.ask(peer.id, workId, '質問です。');
  const id = tl.progress(owner.id, { body: '進捗' });
  tl.reply(third.id, id, '返信です');
  const html = await (await get(owner, '/connections?tab=notifications')).text();
  expect(html).toContain('peerさんから作品への質問が届きました。');
  expect(html).toContain('thirdさんから投稿への返信が届きました。');
  expect(html).toContain('x-notice-reply');
  expect(html).toContain('is-unread');
  expect(html).toContain(`/timeline/${id}#replies`);
  expect(html).toContain('/connections?with=peer');
  expect(html).toMatch(/分前|たった今/);
  await post(owner, '/social/notices/read', {});
  expect(await (await get(owner, '/connections?tab=notifications')).text()).not.toContain(
    'class="x-notice is-unread"',
  );
});

test('プロフィールのPostsは本人の投稿と共有作品だけを未ログインでも表示', async () => {
  tl.progress(owner.id, { body: '配線が終わりました。' });
  tl.progress(peer.id, { body: '他の人の投稿' });
  const html = await (await app.request('/u/owner?tab=posts')).text();
  expect(html).toContain('配線が終わりました。');
  expect(html).toContain('作品の共有');
  expect(html).not.toContain('他の人の投稿');
  expect(html).toContain('href="/login"');
  const works = await (await app.request('/u/owner')).text();
  expect(works).toContain('回路制作');
  expect(works).not.toContain('配線が終わりました。');
  store.publish(owner.id, workId, 1, false);
  expect(await (await app.request('/u/owner?tab=posts')).text()).not.toContain('作品の共有');
  social.block(peer.id, owner.id);
  expect(await (await get(peer, '/u/owner?tab=posts')).text()).not.toContain(
    '配線が終わりました。',
  );
  expect((await app.request('/u/nobody')).status).toBe(404);
});

test('相対時刻はX風に表示', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  expect(ago('2026-11-08T11:59:30Z', now)).toBe('たった今');
  expect(ago('2026-11-08T11:15:00Z', now)).toBe('45分前');
  expect(ago('2026-11-08T07:00:00Z', now)).toBe('5時間前');
  expect(ago('2026-11-05T12:00:00Z', now)).toBe('3日前');
  expect(ago('2026-10-01T12:00:00Z', now)).toBe('10月1日');
  expect(ago('2025-10-01T12:00:00Z', now)).toBe('2025年10月1日');
});
