import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app';
import { Store } from '../src/store';
import { defaultLayout, layoutOf } from '../src/layout';
import type { WorkData } from '../src/schema';

const origin = 'http://localhost:4177';
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const base: WorkData = {
  title: '記憶ゲーム',
  summary: '光と音の記憶ゲームです。',
  kind: 'coursework',
  year: 2025,
  status: 'prototype',
  team_result: '',
  my_roles: ['回路'],
  my_contribution: '回路を設計しました。',
  ingenuity: '音の高さを変えました。',
  outcome: '',
  next_interest: '',
  tags: [],
  asset_ids: [],
  sources: [{ label: 'PRIVATE_SOURCE', note: 'PRIVATE_NOTE' }],
};
let store: Store, app: ReturnType<typeof createApp>, dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kosen-editor-'));
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
async function setup(handle = 'owner') {
  const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const r = await json('/v1/register', {
    email: `${handle}@example.test`,
    password: 'test-password-123',
    display_name: handle,
    handle,
  });
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const { token } = await (await json('/v1/tokens', { label: 't' }, { Cookie: cookie })).json();
  const { work } = await (
    await json('/v1/works', { source_key: 'w', work: base }, { Authorization: `Bearer ${token}` })
  ).json();
  return { cookie, token, id: work.id as string, json };
}

test('標準の並びは画像と各項目で、外した画像は表示から除く', () => {
  expect(defaultLayout(base).map((b) => b.id)).toEqual([
    'field-my_contribution',
    'field-team_result',
    'field-ingenuity',
    'field-outcome',
    'field-next_interest',
  ]);
  const id = crypto.randomUUID();
  const layout = layoutOf({
    asset_ids: [],
    layout: [{ id: 'images-1', type: 'images', asset_ids: [id], columns: 2, size: 'small' }],
  });
  expect(layout[0]).toMatchObject({ asset_ids: [] });
});

test('ブロックの並び・見出し・画像の列と大きさを保存して公開ページの形で表示する', async () => {
  const { cookie, id, json } = await setup();
  const form = new FormData();
  form.append('image', new File([png], 'shot.png', { type: 'image/png' }));
  form.append('alt', '回路図');
  const upload = await app.request(`/works/${id}/assets`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie },
    body: form,
  });
  expect(upload.status).toBe(201);
  const asset = (await upload.json()).id as string;
  const editor = await (await app.request(`/works/${id}`, { headers: { Cookie: cookie } })).text();
  expect(editor).toContain('id="editor-data"');
  const payload = editor.match(/id="editor-data">([\s\S]*?)<\/script>/)![1];
  expect(JSON.parse(payload).data.title).toBe('記憶ゲーム');
  const layout = [
    { id: 'heading-a', type: 'heading', text: '制作の流れ' },
    { id: 'images-a', type: 'images', asset_ids: [asset], columns: 3, size: 'small' },
    { id: 'field-ingenuity', type: 'field', field: 'ingenuity' },
    { id: 'text-a', type: 'text', text: '<script>alert(1)</script>' },
  ];
  const saved = await json(
    `/works/${id}/document`,
    { revision: 1, data: { ...base, sources: [], title: '新しい名前', layout } },
    { Cookie: cookie },
  );
  expect(saved.status).toBe(200);
  expect((await saved.json()).revision).toBe(2);
  const stored = store.work(
    (store.db.query('SELECT owner_id FROM works').get() as { owner_id: string }).owner_id,
    id,
  );
  expect(stored.data.sources[0].label).toBe('PRIVATE_SOURCE');
  expect(stored.data.asset_ids).toContain(asset);
  const preview = await (
    await app.request(`/works/${id}/preview`, { headers: { Cookie: cookie } })
  ).text();
  expect(preview).toContain('gallery cols-3 size-small');
  expect(preview.indexOf('制作の流れ')).toBeLessThan(preview.indexOf('工夫したこと'));
  expect(preview).not.toContain('自分が担当したこと');
  expect(preview).toContain('&lt;script&gt;');
  expect(preview).not.toContain('PRIVATE_NOTE');
  const stale = await json(
    `/works/${id}/document`,
    { revision: 1, data: base },
    { Cookie: cookie },
  );
  expect(stale.status).toBe(409);
});

test('他人の画像や作品・Bearer・別Originでは保存できない', async () => {
  const owner = await setup('owner');
  const other = await setup('other');
  const foreign = await owner.json(
    `/works/${owner.id}/document`,
    {
      revision: 1,
      data: {
        ...base,
        layout: [
          {
            id: 'images-a',
            type: 'images',
            asset_ids: [crypto.randomUUID()],
            columns: 1,
            size: 'large',
          },
        ],
      },
    },
    { Cookie: owner.cookie },
  );
  expect(foreign.status).toBe(422);
  expect(
    (
      await other.json(
        `/works/${owner.id}/document`,
        { revision: 1, data: base },
        { Cookie: other.cookie },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await owner.json(
        `/works/${owner.id}/document`,
        { revision: 1, data: base },
        { Authorization: `Bearer ${owner.token}` },
      )
    ).status,
  ).toBe(403);
  const cross = await app.request(`/works/${owner.id}/document`, {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      Cookie: owner.cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ revision: 1, data: base }),
  });
  expect(cross.status).toBe(403);
});

test('作品一覧は状態で絞り込め、公開ボタンは確認チェックと連動する', async () => {
  const { cookie, id } = await setup();
  const list = await (
    await app.request('/works?filter=agent&view=list', { headers: { Cookie: cookie } })
  ).text();
  expect(list).toContain('エージェントの下書き');
  expect(list).toContain(`/works/${id}/preview`);
  const empty = await (
    await app.request('/works?filter=published', { headers: { Cookie: cookie } })
  ).text();
  expect(empty).toContain('該当する作品はありません');
  const review = await (
    await app.request(`/works/${id}/review`, { headers: { Cookie: cookie } })
  ).text();
  expect(review).toContain('data-confirm-gate');
  expect(review).toContain('data-confirm-submit');
});
