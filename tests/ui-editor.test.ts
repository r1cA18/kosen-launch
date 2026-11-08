import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app';
import { Store } from '../src/store';
import { UiEditor } from '../src/ui-editor';

let root: string;
const source = `export const Page = () => (
  <section>
    <h1>制作の続きが、ここに。</h1>
    <p>
      普段のエージェントと接続すると、
      制作フォルダから作品の下書きを届けられます。
    </p>
    <button>保存</button>
    <a>{open ? 'ホームへ戻る' : 'ログイン'}</a>
  </section>
);
export const other = () => <button>保存</button>;
const note = '作品の内容を保存してください。';
`;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'kosen-uie-'));
  mkdirSync(join(root, 'src'));
  await Bun.write(join(root, 'src/page.tsx'), source);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const read = () => Bun.file(join(root, 'src/page.tsx')).text();

test('一意なJSXの文言と文字列リテラルを書き換える', async () => {
  const editor = new UiEditor(root);
  const results = await editor.apply({
    changes: [
      { from: '制作の続きが、ここに。', to: '制作の続きを、ここから。', all: false },
      {
        from: '普段のエージェントと接続すると、 制作フォルダから作品の下書きを届けられます。',
        to: 'エージェントと接続すると、作品の下書きが届きます。',
        all: false,
      },
      { from: 'ホームへ戻る', to: 'ホームに戻る', all: false },
    ],
  });
  expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);
  expect(results[0].locations).toEqual(['src/page.tsx:3']);
  const text = await read();
  expect(text).toContain('<h1>制作の続きを、ここから。</h1>');
  expect(text).toContain('エージェントと接続すると、作品の下書きが届きます。');
  expect(text).toContain("'ホームに戻る'");
});

test('複数箇所は確認を求め、許可されればすべて変える', async () => {
  const editor = new UiEditor(root);
  const [ambiguous] = await editor.apply({
    changes: [{ from: '保存', to: '保存する', all: false }],
  });
  expect(ambiguous.status).toBe('ambiguous');
  expect(ambiguous.locations).toHaveLength(2);
  expect(await read()).toBe(source);
  const [applied] = await editor.apply({ changes: [{ from: '保存', to: '保存する', all: true }] });
  expect(applied.status).toBe('applied');
  const text = await read();
  expect(text.match(/<button>保存する<\/button>/g)).toHaveLength(2);
  expect(text).toContain("'作品の内容を保存してください。'");
});

test('部分一致や動的な文字列と危険な記号を拒否する', async () => {
  const editor = new UiEditor(root);
  const results = await editor.apply({
    changes: [
      { from: '作品の内容', to: '作品', all: true },
      { from: '新しいお知らせ 3件', to: 'お知らせ', all: false },
      { from: 'ログイン', to: "x' + alert(1) + '", all: false },
      { from: 'ログイン', to: '<script>', all: false },
    ],
  });
  expect(results.map((r) => r.status)).toEqual(['not_found', 'not_found', 'invalid', 'invalid']);
  expect(await read()).toBe(source);
});

test('UI_EDITORが無効なら配信しない。有効でもloopback以外のHostでは使えない', async () => {
  const make = (uiEditor?: UiEditor) =>
    createApp(new Store(), {
      origin: 'http://127.0.0.1:4177',
      assetDirectory: root,
      staticDirectory: resolve('public'),
      skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
      uiEditor,
    });
  const disabled = make();
  const page = await disabled.request('http://127.0.0.1:4177/login');
  expect(await page.text()).not.toContain('ui-editor');
  expect((await disabled.request('http://127.0.0.1:4177/__ui-editor/editor.js')).status).toBe(404);

  const enabled = make(new UiEditor(root));
  const local = await enabled.request('http://127.0.0.1:4177/login');
  expect(await local.text()).toContain('/__ui-editor/editor.js');
  const script = await enabled.request('http://127.0.0.1:4177/__ui-editor/editor.js');
  expect(script.status).toBe(200);
  const remote = await enabled.request('http://kosen.example/login');
  expect(await remote.text()).not.toContain('ui-editor');
  const post = (host: string, origin: string) =>
    enabled.request(`http://${host}/__ui-editor/apply`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: [{ from: 'ログイン', to: 'サインイン' }] }),
    });
  expect((await post('kosen.example', 'http://127.0.0.1:4177')).status).toBe(404);
  expect((await post('127.0.0.1:4177', 'https://evil.example')).status).toBe(403);
  const ok = await post('127.0.0.1:4177', 'http://127.0.0.1:4177');
  expect((await ok.json()).results[0].status).toBe('applied');
  await Bun.sleep(400);
  expect(await read()).toContain("'サインイン'");
});
