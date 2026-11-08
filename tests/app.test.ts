import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app';
import { Store } from '../src/store';
import type { WorkData } from '../src/schema';

export const example: WorkData = {
  title: '単語帳の自由制作',
  summary: '授業でHTMLとCSSを使って制作した単語帳です。',
  kind: 'coursework',
  year: 2024,
  status: 'prototype',
  team_result: '',
  my_roles: ['企画', 'UI'],
  my_contribution: '画面の設計とカード表示を担当しました。',
  ingenuity: '復習しやすい表示を考えました。',
  outcome: '試作を作りました。',
  next_interest: '発表して意見をもらいたいです。',
  tags: ['HTML', '学習'],
  asset_ids: [],
  sources: [{ label: 'PRIVATE_SOURCE', note: 'PRIVATE_NOTE' }],
};
const origin = 'http://localhost:4177';
let store: Store, app: ReturnType<typeof createApp>, directory: string;
function req(
  path: string,
  method = 'GET',
  body?: unknown,
  cookie?: string,
  token?: string,
  requestOrigin = origin,
) {
  const headers: Record<string, string> = { Origin: requestOrigin };
  if (cookie) headers.Cookie = cookie;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  return app.request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
async function account(handle: string) {
  const response = await req('/v1/register', 'POST', {
    email: `${handle}@example.test`,
    password: 'test-password-123',
    display_name: handle,
    handle,
    school: 'PRIVATE_SCHOOL',
  });
  expect(response.status).toBe(201);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const { user } = await response.json();
  const tokenResponse = await req('/v1/tokens', 'POST', { label: 'test' }, cookie);
  const token = await tokenResponse.json();
  return { cookie, user, token };
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'kosen-test-'));
  store = new Store();
  app = createApp(store, {
    origin,
    assetDirectory: directory,
    staticDirectory: resolve('public'),
    skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
  });
});
afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('登録から公開まで', () => {
  test('登録・再ログイン・重複登録とCookie属性', async () => {
    const owner = await account('owner');
    expect((await req('/v1/me', 'GET', undefined, owner.cookie)).status).toBe(200);
    const login = await req('/v1/login', 'POST', {
      email: 'owner@example.test',
      password: 'test-password-123',
    });
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    expect(login.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(
      (await req('/v1/login', 'POST', { email: 'owner@example.test', password: 'incorrect' }))
        .status,
    ).toBe(401);
    expect(
      (
        await req('/v1/register', 'POST', {
          email: 'owner@example.test',
          password: 'test-password-123',
          display_name: 'Duplicate',
          handle: 'duplicate',
        })
      ).status,
    ).toBe(409);
  });
  test('下書きの作成は冪等・他人から非公開・公開は本人の版だけ', async () => {
    const owner = await account('owner'),
      other = await account('other');
    const input = { source_key: 'vocabulary', work: example };
    const created = await req('/v1/works', 'POST', input, undefined, owner.token.token);
    expect(created.status).toBe(201);
    const { work } = await created.json();
    const duplicate = await req('/v1/works', 'POST', input, undefined, owner.token.token);
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json()).work.id).toBe(work.id);
    expect((await req(`/v1/works/${work.id}`, 'GET', undefined, other.cookie)).status).toBe(404);
    expect((await req(`/u/owner/works/${work.id}`)).status).toBe(404);
    expect(
      (
        await req(
          `/v1/works/${work.id}/publication`,
          'POST',
          { revision: 1, share_to_feed: true },
          undefined,
          owner.token.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (await req('/v1/tokens', 'POST', { label: 'bad' }, undefined, owner.token.token)).status,
    ).toBe(403);
    expect(
      (
        await req(
          `/v1/works/${work.id}/publication`,
          'POST',
          { revision: 1, share_to_feed: true },
          other.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await req(
          `/v1/works/${work.id}/publication`,
          'POST',
          { revision: 1, share_to_feed: true },
          owner.cookie,
          undefined,
          'https://other.test',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          `/v1/works/${work.id}/publication`,
          'POST',
          { revision: 2, share_to_feed: true },
          owner.cookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await req(
          `/v1/works/${work.id}/publication`,
          'POST',
          { revision: 1, share_to_feed: true },
          owner.cookie,
        )
      ).status,
    ).toBe(200);
    const html = await (await req(`/u/owner/works/${work.id}`)).text();
    expect(html).toContain(example.title);
    expect(html).not.toContain('PRIVATE_');
    const changed = { ...example, title: '編集後の非公開タイトル' };
    expect(
      (await req(`/v1/works/${work.id}`, 'PUT', { base_revision: 1, work: changed }, owner.cookie))
        .status,
    ).toBe(200);
    expect(
      (await req(`/v1/works/${work.id}`, 'PUT', { base_revision: 1, work: changed }, owner.cookie))
        .status,
    ).toBe(409);
    expect(await (await req(`/u/owner/works/${work.id}`)).text()).not.toContain(changed.title);
    expect(
      (
        await req(
          `/v1/works/${work.id}/publication`,
          'POST',
          { revision: 1, share_to_feed: true },
          owner.cookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (await req(`/v1/works/${work.id}/publication`, 'DELETE', undefined, owner.cookie)).status,
    ).toBe(200);
    expect((await req(`/u/owner/works/${work.id}`)).status).toBe(404);
  });
  test('エージェントの更新案は本人の採用まで反映されず競合は保持', async () => {
    const { user, cookie, token } = await account('owner');
    const { work } = store.createWork(user.id, 'one', example);
    const proposal = await req(
      `/v1/works/${work.id}/proposals`,
      'POST',
      { base_revision: 1, work: { ...example, title: '提案された題名' } },
      undefined,
      token.token,
    );
    expect(proposal.status).toBe(201);
    const { proposal_id } = await proposal.json();
    expect(store.work(user.id, work.id).data.title).toBe(example.title);
    expect((await req(`/proposals/${proposal_id}/accept`, 'POST', undefined, cookie)).status).toBe(
      303,
    );
    expect(store.work(user.id, work.id).data.title).toBe('提案された題名');
    const pending = store.propose(user.id, work.id, 2, example);
    store.updateWork(user.id, work.id, 2, { ...example, title: '人間の最新変更' });
    expect(
      (await req(`/proposals/${pending.proposal_id}/accept`, 'POST', undefined, cookie)).status,
    ).toBe(409);
    expect(store.work(user.id, work.id).data.title).toBe('人間の最新変更');
    expect(
      (
        await req(
          `/v1/works/${work.id}`,
          'PUT',
          { base_revision: 3, work: example },
          undefined,
          token.token,
        )
      ).status,
    ).toBe(403);
  });
  test('画像の所有権と公開状態・失効・XSS', async () => {
    const owner = await account('owner'),
      other = await account('other');
    const image = new FormData();
    image.set(
      'image',
      new File(
        [
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
          ),
        ],
        'test.png',
        {
          type: 'image/png',
        },
      ),
    );
    image.set('alt', 'テスト画像');
    const uploaded = await app.request('/v1/assets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${owner.token.token}` },
      body: image,
    });
    expect(uploaded.status).toBe(201);
    const { asset_id } = await uploaded.json();
    expect((await req(`/assets/${asset_id}`)).status).toBe(404);
    expect((await req(`/assets/${asset_id}`, 'GET', undefined, other.cookie)).status).toBe(404);
    const payload = { ...example, title: '<script>alert(1)</script>', asset_ids: [asset_id] };
    expect(
      (
        await req(
          '/v1/works',
          'POST',
          { source_key: 'stolen', work: payload },
          undefined,
          other.token.token,
        )
      ).status,
    ).toBe(422);
    const { work } = store.createWork(owner.user.id, 'own', payload);
    store.publish(owner.user.id, work.id, 1, true);
    expect((await req(`/assets/${asset_id}`)).status).toBe(200);
    const html = await (await req(`/u/owner/works/${work.id}`)).text();
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
    store.withdraw(owner.user.id, work.id);
    expect((await req(`/assets/${asset_id}`)).status).toBe(404);
    await req(`/v1/tokens/${owner.token.id}`, 'DELETE', undefined, owner.cookie);
    expect((await req('/v1/works', 'GET', undefined, undefined, owner.token.token)).status).toBe(
      401,
    );
  });
  test('ホームへの共有は任意でリアクションは一人一件', async () => {
    const owner = await account('owner'),
      viewer = await account('viewer');
    const { work } = store.createWork(owner.user.id, 'opt-in', example);
    store.publish(owner.user.id, work.id, 1, false);
    expect(store.published()).toHaveLength(0);
    expect((await req('/u/owner?year=2024&tag=HTML')).status).toBe(200);
    expect(await (await req('/u/owner?year=2025')).text()).not.toContain(example.title);
    expect((await req(`/works/${work.id}/react`, 'POST', undefined, viewer.cookie)).status).toBe(
      404,
    );
    store.publish(owner.user.id, work.id, 1, true);
    expect(store.published()).toHaveLength(1);
    expect((await req(`/works/${work.id}/react`, 'POST', undefined, viewer.cookie)).status).toBe(
      303,
    );
    expect(store.reactionCount(work.id)).toBe(1);
    await req(`/works/${work.id}/react`, 'POST', undefined, viewer.cookie);
    expect(store.reactionCount(work.id)).toBe(0);
  });
  test('SQLiteの再起動後も公開版と下書き版を保持', async () => {
    const filename = join(directory, 'persistent.sqlite');
    const db = new Store(filename);
    const user = await db.register({
      email: 'persist@example.test',
      password: 'test-password-123',
      handle: 'persist',
      display_name: 'Persist',
      school: '',
      department: '',
      grade: '',
    });
    const { work } = db.createWork(user.id, 'persistent', example);
    db.publish(user.id, work.id, 1, true);
    db.updateWork(user.id, work.id, 1, { ...example, title: '下書き2' });
    db.close();
    const reopened = new Store(filename);
    try {
      expect(reopened.work(user.id, work.id).revision).toBe(2);
      expect(reopened.published('persist')[0].data.title).toBe(example.title);
    } finally {
      reopened.close();
    }
  });
});
