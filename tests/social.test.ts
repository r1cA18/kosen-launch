import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store, type User } from '../src/store';
import { SocialStore } from '../src/social';
import { createApp } from '../src/app';
import { workSchema } from '../src/schema';

let store: Store, social: SocialStore, app: ReturnType<typeof createApp>, dir: string;
let owner: User, peer: User, third: User, workId: string;
const origin = 'http://localhost:4177';
const invitation = {
  event_title: '制作物を紹介するLT',
  event_url: 'https://example.test/event',
  purpose: '回路とUIの経験を組み合わせて展示したいです。',
  sender_role: 'UIと発表',
  recipient_role: '回路制御',
  next_step: '日曜に題材を相談します。',
};
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
  assessment: {
    basis: 'inferred',
    evidence: 'PRIVATE_EVIDENCE',
    uncertainties: ['PRIVATE_UNCERTAINTY'],
  },
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
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kosen-social-'));
  store = new Store(join(dir, 'db.sqlite'));
  social = new SocialStore(store);
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
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test('質問から返信と通知まで。公開内容に私的な根拠を混ぜない', async () => {
  let r = await form(peer, `/social/works/${workId}/questions`, {
    body: '分担はどうしましたか？ <script>alert(1)</script>',
  });
  expect(r.status).toBe(303);
  const q = social.questions(workId)[0];
  expect(q.body).toContain('分担');
  expect(social.notices(owner.id)[0].read).toBe(0);
  expect(
    (await form(third, `/social/questions/${q.id}/answer`, { answer: '偽の作者' })).status,
  ).toBe(403);
  expect(
    (await form(owner, `/social/questions/${q.id}/answer`, { answer: '制御を分けて進めました。' }))
      .status,
  ).toBe(303);
  expect(social.notices(peer.id)).toHaveLength(1);
  const html = await (await app.request(`/u/owner/works/${workId}`)).text();
  expect(html).toContain('制御を分けて');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>alert');
  expect(html).not.toContain('PRIVATE_');
  social.read(peer.id);
  expect(social.notices(peer.id)[0].read).toBe(1);
  expect((await form(third, `/social/questions/${q.id}/delete`, {})).status).toBe(403);
  expect((await form(peer, `/social/questions/${q.id}/delete`, {})).status).toBe(303);
  expect(social.questions(workId)).toHaveLength(0);
});
test('誘いは相手だけが返答。連絡先は受け入れ後だけ。重複と古い状態を拒否', async () => {
  expect((await form(peer, `/social/works/${workId}/invitations`, invitation)).status).toBe(303);
  const i = social.invitations(owner.id)[0];
  expect(social.invitations(third.id)).toHaveLength(0);
  expect((await form(peer, `/social/works/${workId}/invitations`, invitation)).status).toBe(409);
  expect(
    (await form(peer, `/social/invitations/${i.id}/state`, { state: 'accepted' })).status,
  ).toBe(403);
  expect(
    (await form(third, `/social/invitations/${i.id}/state`, { state: 'accepted' })).status,
  ).toBe(404);
  expect(
    (
      await form(peer, `/social/invitations/${i.id}/contact`, {
        contact: 'https://example.test/peer',
      })
    ).status,
  ).toBe(409);
  expect(
    (await form(owner, `/social/invitations/${i.id}/state`, { state: 'accepted' })).status,
  ).toBe(303);
  expect(
    (await form(owner, `/social/invitations/${i.id}/state`, { state: 'declined' })).status,
  ).toBe(409);
  expect(
    (await form(peer, `/social/invitations/${i.id}/contact`, { contact: 'javascript:alert(1)' }))
      .status,
  ).toBe(422);
  expect(
    (
      await form(peer, `/social/invitations/${i.id}/contact`, {
        contact: 'https://example.test/peer',
      })
    ).status,
  ).toBe(303);
  expect(social.invitations(owner.id)[0].sender_contact).toBe('https://example.test/peer');
  const second = new Store(join(dir, 'db.sqlite'));
  expect(new SocialStore(second).invitations(owner.id)[0].state).toBe('accepted');
  second.close();
  expect((await form(peer, `/social/invitations/${i.id}/contact`, { contact: '' })).status).toBe(
    303,
  );
  expect(social.invitations(owner.id)[0].sender_contact).toBe('');
});
test('非共有と公開停止とブロックは交流を止める。通報は本人の画面で非表示', async () => {
  const q = social.ask(peer.id, workId, '作品の質問です。');
  social.report(owner.id, q, '無関係な内容');
  expect(social.questions(workId, owner.id)).toHaveLength(0);
  expect(social.questions(workId, third.id)).toHaveLength(1);
  const i = social.invite(peer.id, workId, invitation);
  social.decide(owner.id, i, 'accepted');
  social.contact(peer.id, i, 'https://example.test/private');
  social.block(owner.id, peer.id);
  expect(social.invitations(peer.id)).toHaveLength(0);
  expect(social.feed(peer.id)).toHaveLength(0);
  expect((await form(peer, `/social/works/${workId}/questions`, { body: 'blocked' })).status).toBe(
    404,
  );
  expect((await form(peer, `/works/${workId}/react`, {})).status).toBe(404);
  social.unblock(owner.id, peer.id);
  expect(social.invitations(peer.id)[0].state).toBe('cancelled');
  expect(social.invitations(peer.id)[0].sender_contact).toBe('');
  store.publish(owner.id, workId, 1, false);
  expect((await form(third, `/social/works/${workId}/questions`, { body: 'hidden' })).status).toBe(
    404,
  );
  expect(social.notices(owner.id)).toHaveLength(0);
  store.withdraw(owner.id, workId);
  expect((await app.request(`/u/owner/works/${workId}`)).status).toBe(404);
  expect(social.invitations(owner.id)).toHaveLength(0);
  store.publish(owner.id, workId, 1, true);
  expect(social.notices(owner.id)).toHaveLength(0);
});
test('SNSは本人セッションと同一Originが必須。エージェントに発信させない', async () => {
  const token = store.createToken(peer.id, 'agent').token;
  expect(
    (
      await form(
        peer,
        `/social/works/${workId}/questions`,
        { body: 'csrf' },
        { Origin: 'https://evil.test' },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await form(
        peer,
        `/social/works/${workId}/questions`,
        { body: 'agent' },
        { Authorization: `Bearer ${token}` },
      )
    ).status,
  ).toBe(403);
  expect((await app.request('/connections')).status).toBe(401);
  expect(
    (
      await form(peer, `/social/works/${workId}/invitations`, {
        ...invitation,
        event_url: 'https://secret@event.test',
      })
    ).status,
  ).toBe(422);
});
