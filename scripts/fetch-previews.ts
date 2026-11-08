// Fetches site previews for suggestions and opportunities that have none.
// Usage: bun scripts/fetch-previews.ts --db <path> --assets <dir>
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Store } from '../src/store';
import { Opportunities } from '../src/opportunities';
import { Previews } from '../src/preview';

const { values } = parseArgs({
  options: { db: { type: 'string' }, assets: { type: 'string' } },
});
if (!values.db || !values.assets) {
  console.error('Usage: bun scripts/fetch-previews.ts --db <path> --assets <dir>');
  process.exit(2);
}
const store = new Store(values.db);
try {
  new Opportunities(store); // makes sure both tables exist
  const previews = new Previews(store, {
    directory: join(resolve(values.assets), 'event-previews'),
  });
  const urls = [...new Set(previews.ensureAll())];
  await previews.idle();
  let ok = 0;
  for (const url of urls) {
    const p = previews.get(url);
    if (p && !p.error) ok++;
    console.log(
      `${p?.error ? 'failed' : 'ok    '} ${url}${p?.error ? ` (${p.error})` : ` image=${p?.image_id ? 'yes' : 'no'} icon=${p?.icon_id ? 'yes' : 'no'}`}`,
    );
  }
  console.log(`${ok}/${urls.length} fetched`);
} finally {
  store.close();
}
