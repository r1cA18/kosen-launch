import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { Glob } from 'bun';
import { createApp } from '../src/app';
import { Store } from '../src/store';

const app = () =>
  createApp(new Store(), {
    origin: 'http://127.0.0.1:4177',
    assetDirectory: resolve('.data/test-assets'),
    staticDirectory: resolve('public'),
    skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
  });

test('未ログインのトップはヒーローを表示し登録とログインへ案内する', async () => {
  const response = await app().request('http://127.0.0.1:4177/');
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('<h1>Kosen Launch</h1>');
  expect(html).toContain('href="/register"');
  expect(html).toContain('href="/login"');
  expect(html).toContain('How it works');
});

test('ログインとアカウント作成はタブで切り替えられる', async () => {
  for (const [path, active] of [
    ['/login', 'ログイン'],
    ['/register', 'アカウント作成'],
  ]) {
    const html = await (await app().request(`http://127.0.0.1:4177${path}`)).text();
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(new RegExp(`class="tab tab-active"[^>]*>${active}<`));
    expect(html).toContain('class="fieldset"');
  }
});

test('画面の文言に比喩や呼びかけの定型句を使わない', async () => {
  const banned = [
    '外につながる',
    '一緒に整えましょう',
    '始めましょう',
    '制作の続きが',
    '伝わるかたちに',
    '次の一歩',
    'その先へ',
  ];
  for await (const file of new Glob('src/**/*.tsx').scan('.')) {
    const text = await Bun.file(file).text();
    for (const phrase of banned) expect(`${file}: ${text.includes(phrase)}`).toBe(`${file}: false`);
  }
});
