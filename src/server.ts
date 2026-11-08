import { resolve } from 'node:path';
import { createApp } from './app';
import { Store } from './store';
import { Discovery } from './discovery';
import { Opportunities } from './opportunities';
import { UiEditor, prettier } from './ui-editor';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4177);
const origin = process.env.APP_ORIGIN ?? `http://${host}:${port}`;
const store = new Store(process.env.DATABASE_PATH ?? '.data/kosen-launch.sqlite');
const claude = {
  key: process.env.ANTHROPIC_API_KEY,
  model: process.env.ANTHROPIC_MODEL,
  rustxng: process.env.RUSTXNG_URL,
};
const app = createApp(store, {
  origin,
  assetDirectory: resolve(process.env.ASSET_DIRECTORY ?? '.data/assets'),
  staticDirectory: resolve('public'),
  skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
  claude,
  uiEditor:
    process.env.UI_EDITOR === '1' && ['127.0.0.1', 'localhost'].includes(host)
      ? new UiEditor(resolve('.'), (files) => prettier(resolve('.'), files))
      : undefined,
});
// Event discovery: at start and hourly, once a day per recently active person.
const stopDiscovery = new Discovery(store, new Opportunities(store, claude), claude).start();
const server = Bun.serve({ hostname: host, port, fetch: app.fetch });
console.log(`Kosen Launch: ${origin}`);
if (process.env.UI_EDITOR === '1') console.log('UI editor: enabled on loopback only');
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    stopDiscovery();
    server.stop(true);
    store.close();
    process.exit(0);
  });
