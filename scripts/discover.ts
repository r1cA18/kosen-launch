// Runs event discovery once for one person and stores the results in the given database.
// Usage: bun --env-file=<env> scripts/discover.ts --db <path> --handle <handle> [--force]
import { parseArgs } from 'node:util';
import { Store } from '../src/store';
import { Opportunities } from '../src/opportunities';
import { Discovery } from '../src/discovery';

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
    handle: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});
if (!values.db || !values.handle) {
  console.error('Usage: bun scripts/discover.ts --db <path> --handle <handle> [--force]');
  process.exit(2);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set.');
  process.exit(2);
}
const store = new Store(values.db);
try {
  const user = store.db.query('SELECT id FROM users WHERE handle=?').get(values.handle) as {
    id: string;
  } | null;
  if (!user) throw new Error(`No user with handle ${values.handle}`);
  const options = {
    key: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL,
    rustxng: process.env.RUSTXNG_URL,
  };
  const opportunities = new Opportunities(store, options);
  const discovery = new Discovery(store, opportunities, options);
  const started = Date.now();
  const id = await discovery.run(user.id, values.force); // --force skips only the once-a-day rule
  if (!id) {
    console.log('Skipped: a run is already in progress or ran within 24 hours (use --force).');
  } else {
    const run = discovery.last(user.id)!;
    console.log(
      JSON.stringify(
        {
          state: run.state,
          source: run.source,
          seconds: Math.round((Date.now() - started) / 1000),
          found: run.found,
          added: run.added,
          input_tokens: run.input_tokens,
          output_tokens: run.output_tokens,
          search_requests: run.search_requests,
          error: run.error || undefined,
        },
        null,
        2,
      ),
    );
    for (const s of opportunities.suggestions(user.id).filter((s) => s.run_id === id))
      console.log(
        `\n- ${s.title}\n  ${s.url}\n  ${s.date || '日付未確認'} / 締切 ${s.deadline || '未確認'} / ${s.location || '場所未確認'} / ${s.confidence}\n  理由: ${s.reason}\n  役割: ${s.role}`,
      );
  }
} finally {
  store.close();
}
