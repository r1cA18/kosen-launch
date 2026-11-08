import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { createApp } from '../src/app';
import { Store } from '../src/store';

const make = (origin: string, registrationCode?: string) =>
  createApp(new Store(), {
    origin,
    assetDirectory: resolve('.data/test-assets'),
    staticDirectory: resolve('public'),
    skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
    registrationCode,
  });
const account = {
  email: 'a@example.test',
  password: 'test-password-123',
  display_name: 'a',
  handle: 'aaa',
};

test('招待コードが設定されていると、コードなしと誤ったコードの登録を拒否する', async () => {
  const origin = 'https://kosen.example';
  const app = make(origin, 'secret-invite');
  const post = (body: unknown) =>
    app.request(`${origin}/v1/register`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  expect((await post(account)).status).toBe(403);
  expect((await post({ ...account, invite_code: 'wrong' })).status).toBe(403);
  expect((await post({ ...account, invite_code: 'secret-invite' })).status).toBe(201);
  const form = await app.request(`${origin}/register`);
  expect(await form.text()).toContain('name="invite_code"');
  const web = await app.request(`${origin}/register`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...account, email: 'b@example.test', handle: 'bbb' }),
  });
  expect(web.status).toBe(403);
});

test('HTTPSではHSTSとSecure Cookieを付け、招待コードなしの環境では従来どおり登録できる', async () => {
  const https = make('https://kosen.example');
  const page = await https.request('https://kosen.example/login');
  expect(page.headers.get('Strict-Transport-Security')).toContain('max-age=');
  const r = await https.request('https://kosen.example/v1/register', {
    method: 'POST',
    headers: { Origin: 'https://kosen.example', 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  });
  expect(r.status).toBe(201);
  expect(r.headers.get('set-cookie')).toContain('Secure');
  const http = make('http://127.0.0.1:4177');
  expect(
    (await http.request('http://127.0.0.1:4177/login')).headers.get('Strict-Transport-Security'),
  ).toBeNull();
});

test('登録の入力ミスは項目ごとの理由を示し、公開IDの大文字は小文字にして受け付ける', async () => {
  const origin = 'https://kosen.example';
  const app = make(origin);
  const post = (fields: Record<string, string>) =>
    app.request(`${origin}/register`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    });
  const bad = await post({ ...account, handle: 'kosen_student' });
  expect(bad.status).toBe(422);
  expect(await bad.text()).toContain('公開IDは小文字の英字で始まり');
  const short = await post({ ...account, password: 'short' });
  expect(await short.text()).toContain('パスワードは10〜128文字');
  const upper = await post({ ...account, handle: 'Kosen-Student' });
  expect(upper.status).toBe(303);
  expect(await (await app.request(`${origin}/u/kosen-student`)).text()).toContain('@kosen-student');
});
