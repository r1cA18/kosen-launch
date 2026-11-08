import { resolve } from 'node:path';
import { createApp } from './app';
import { Store } from './store';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4177);
const origin = process.env.APP_ORIGIN ?? `http://${host}:${port}`;
const store = new Store(process.env.DATABASE_PATH ?? '.data/kosen-launch.sqlite');
const app = createApp(store, {
  origin,
  assetDirectory: resolve(process.env.ASSET_DIRECTORY ?? '.data/assets'),
  staticDirectory: resolve('public'),
  skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
  claude: { key: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL },
});
const server = Bun.serve({ hostname: host, port, fetch: app.fetch });
console.log(`Kosen Launch: ${origin}`);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.stop(true);
    store.close();
    process.exit(0);
  });
