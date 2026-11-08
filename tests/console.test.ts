import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app';
import { Store } from '../src/store';
import { applyAllFixes, checkWork, findMatches, replaceAll } from '../src/console';
import type { WorkData } from '../src/schema';

const base: WorkData = {
  title: 'Ｓｉｍｏｎ Saysゲーム',
  summary: 'javascriptとArduinoで作った記憶ゲームです。',
  kind: 'coursework',
  year: null,
  status: 'prototype',
  team_result: '',
  my_roles: ['回路', 'github管理'],
  my_contribution: '回路を設計した。',
  ingenuity: 'ＬＥＤの  点灯順を工夫しました。',
  outcome: '',
  next_interest: '',
  tags: ['電子工作'],
  asset_ids: [],
  sources: [],
};
const origin = 'http://localhost:4177';
let store: Store, app: ReturnType<typeof createApp>, directory: string;
const form = (path: string, fields: Record<string, string | string[]>, cookie: string) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields))
    for (const item of ([] as string[]).concat(v)) body.append(k, item);
  return app.request(path, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
};
async function setup(handle = 'owner') {
  const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const registered = await json('/v1/register', {
    email: `${handle}@example.test`,
    password: 'test-password-123',
    display_name: handle,
    handle,
  });
  const cookie = registered.headers.get('set-cookie')!.split(';')[0];
  const { token } = await (await json('/v1/tokens', { label: 'test' }, { Cookie: cookie })).json();
  const created = await json(
    '/v1/works',
    { source_key: 'simon', work: base },
    { Authorization: `Bearer ${token}` },
  );
  const { work } = await created.json();
  return { cookie, token, id: work.id as string };
}
const get = (path: string, cookie: string) => app.request(path, { headers: { Cookie: cookie } });
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'kosen-console-'));
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

describe('表記チェック', () => {
  test('自動で直せる表記と文末の指摘', () => {
    const rules = checkWork(base).map((i) => `${i.field}:${i.rule}`);
    expect(rules).toContain('title:fullwidth-alnum');
    expect(rules).toContain('summary:product-name');
    expect(rules).toContain('my_roles:product-name');
    expect(rules).toContain('ingenuity:spaces');
    expect(rules).toContain('my_contribution:plain-style');
    const fixed = applyAllFixes(base);
    expect(fixed.title).toBe('Simon Saysゲーム');
    expect(fixed.summary).toBe('JavaScriptとArduinoで作った記憶ゲームです。');
    expect(fixed.my_roles).toEqual(['回路', 'GitHub管理']);
    expect(fixed.ingenuity).toBe('LEDの 点灯順を工夫しました。');
    expect(checkWork(fixed).filter((i) => i.after !== undefined)).toEqual([]);
    expect(fixed.my_contribution).toBe(base.my_contribution);
  });
  test('一括置換は本文と一覧の両方を対象にする', () => {
    expect(findMatches(base, '回路', '電子回路').map((m) => m.field)).toEqual([
      'my_contribution',
      'my_roles',
    ]);
    const replaced = replaceAll(base, '回路', '電子回路');
    expect(replaced.my_roles[0]).toBe('電子回路');
    expect(replaced.sources).toEqual(base.sources);
  });
});

describe('編集コンソール', () => {
  test('見た目のまま編集して保存しコンソールへ戻る', async () => {
    const { cookie, id } = await setup();
    const page = await get(`/works/${id}/console`, cookie);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('data-field="title"');
    expect(html).toContain('/console.js');
    const saved = await form(
      `/works/${id}/save`,
      {
        revision: '1',
        return: 'console',
        ...base,
        title: '記憶ゲーム',
        year: '',
        my_roles: '回路、組み込み',
        tags: '電子工作',
      } as unknown as Record<string, string>,
      cookie,
    );
    expect(saved.status).toBe(303);
    expect(saved.headers.get('location')).toBe(`/works/${id}/console?saved=1`);
    const row = store.db.query('SELECT owner_id FROM works').get() as { owner_id: string };
    const work = store.works(row.owner_id)[0];
    expect(work.data.title).toBe('記憶ゲーム');
    expect(work.data.my_roles).toEqual(['回路', '組み込み']);
    expect(work.published_revision).toBeNull();
  });
  test('修正の適用と古い版の拒否', async () => {
    const { cookie, id } = await setup();
    const one = await form(
      `/works/${id}/console/fix`,
      { revision: '1', field: 'title', rule: 'fullwidth-alnum' },
      cookie,
    );
    expect(one.status).toBe(303);
    const stale = await form(`/works/${id}/console/fix`, { revision: '1', rule: 'all' }, cookie);
    expect(stale.status).toBe(409);
    const all = await form(`/works/${id}/console/fix`, { revision: '2', rule: 'all' }, cookie);
    expect(all.status).toBe(303);
    const html = await (await get(`/works/${id}/console?fixed=1`, cookie)).text();
    expect(html).toContain('表記を修正しました。');
    expect(html).toContain('JavaScriptとArduino');
    const bad = await form(
      `/works/${id}/console/fix`,
      { revision: '3', field: 'sources', rule: 'spaces' },
      cookie,
    );
    expect(bad.status).toBe(422);
  });
  test('一括置換のプレビューと適用と他人の作品の拒否', async () => {
    const owner = await setup();
    const preview = await (
      await get(`/works/text?find=${encodeURIComponent('回路')}&replace=x`, owner.cookie)
    ).text();
    expect(preview).toContain('2か所');
    const applied = await form(
      '/works/text',
      { find: '回路', replace: '電子回路', work: owner.id, [`revision_${owner.id}`]: '1' },
      owner.cookie,
    );
    expect(applied.headers.get('location')).toBe('/works/text?updated=1&conflicts=0');
    const conflict = await form(
      '/works/text',
      { find: '電子', replace: '', work: owner.id, [`revision_${owner.id}`]: '1' },
      owner.cookie,
    );
    expect(conflict.headers.get('location')).toBe('/works/text?updated=0&conflicts=1');
    const other = await setup('other');
    const denied = await form(
      '/works/text',
      { find: '回路', replace: 'x', work: owner.id, [`revision_${owner.id}`]: '2' },
      other.cookie,
    );
    expect(denied.status).toBe(404);
  });
  test('BearerトークンとOriginの異なる送信を拒否', async () => {
    const { cookie, token, id } = await setup();
    const bearer = await app.request(`/works/${id}/console`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(bearer.status).toBe(403);
    const cross = await app.request(`/works/${id}/console/fix`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Cookie: cookie },
      body: new URLSearchParams({ revision: '1', rule: 'all' }),
    });
    expect(cross.status).toBe(403);
  });
  test('入力した文字列をエスケープして表示', async () => {
    const { cookie, id } = await setup();
    await form(
      `/works/${id}/save`,
      {
        revision: '1',
        return: 'console',
        ...base,
        title: '<script>alert(1)</script>',
        year: '',
        my_roles: '回路',
        tags: '',
      } as unknown as Record<string, string>,
      cookie,
    );
    const html = await (await get(`/works/${id}/console`, cookie)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
