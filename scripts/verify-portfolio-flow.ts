import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { Store } from '../src/store';
import { createApp } from '../src/app';
import { SocialStore } from '../src/social';
import { workSchema } from '../src/schema';

// Run only with a locally reviewed fixture. Source material is never uploaded wholesale.
const path = process.env.PORTFOLIO_FIXTURE;
if (!path) throw new Error('Set PORTFOLIO_FIXTURE to a reviewed local JSON fixture.');
const fixture = z
  .array(
    z.object({
      source_key: z.string(),
      work: workSchema,
      images: z.array(z.object({ path: z.string(), alt: z.string() })).default([]),
    }),
  )
  .min(1)
  .parse(await Bun.file(path).json());
const directory = mkdtempSync(join(tmpdir(), 'kosen-real-flow-'));
const store = new Store(join(directory, 'app.sqlite'));
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: () => new Response('starting', { status: 503 }),
});
const origin = `http://127.0.0.1:${server.port}`;
const app = createApp(store, {
  origin,
  assetDirectory: join(directory, 'assets'),
  staticDirectory: resolve('public'),
  skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
});
server.reload({ fetch: app.fetch });
const social = new SocialStore(store);
const client = new Client({ name: 'portfolio-local-e2e', version: '1.0.0' });
let transport: StdioClientTransport | undefined;
let checks = 0;
const check = (value: unknown, message: string) => {
  assert.ok(value, message);
  checks++;
};
async function json(path: string, body: unknown, cookie = '') {
  const r = await fetch(origin + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  check(r.ok, `${path}: ${r.status}`);
  return { r, body: await r.json() };
}
async function form(path: string, body: Record<string, string>, cookie: string) {
  const r = await fetch(origin + path, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie },
    body: new URLSearchParams(body),
    redirect: 'manual',
  });
  check(r.status === 303, `${path}: ${r.status}`);
  return r;
}
async function register(handle: string, display_name: string) {
  const { r, body } = await json('/v1/register', {
    email: `${handle}@example.test`,
    password: 'local-review-2026',
    handle,
    display_name,
  });
  return { user: body.user, cookie: r.headers.get('set-cookie')!.split(';')[0] };
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  check(!r.isError, `MCP ${name}`);
  return JSON.parse((r.content as { text: string }[])[0].text);
}
try {
  const owner = await register('local-maker', '制作記録テスト'),
    peer = await register('local-peer', '交流テスト');
  const token = (await json('/v1/tokens', { label: 'Real material local QA' }, owner.cookie)).body;
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('src/mcp.ts')],
    env: { KOSEN_LAUNCH_URL: origin, KOSEN_LAUNCH_TOKEN: token.token },
    stderr: 'pipe',
  });
  await client.connect(transport);
  check((await call('get_authoring_rules')).schema.properties.assessment, 'Assessment contract');
  check((await call('list_works')).works.length === 0, 'New account starts empty');
  const imported: { id: string; title: string; basis?: string }[] = [];
  for (const item of fixture) {
    const images = [];
    for (const image of item.images) {
      const r = await call('upload_image', { file_path: image.path, alt: image.alt });
      images.push(r.asset_id);
      check(
        (await fetch(origin + `/assets/${r.asset_id}`)).status === 404,
        'Draft asset is private',
      );
    }
    const data = { ...item.work, asset_ids: images };
    const draft = await call('create_work_draft', { source_key: item.source_key, work: data });
    const id = draft.work.id;
    check(
      (await call('create_work_draft', { source_key: item.source_key, work: data })).created ===
        false,
      'Repeat import is idempotent',
    );
    const review = await call('prepare_publication', { work_id: id });
    check(
      (await fetch(review.review_url, { headers: { Cookie: owner.cookie } })).status === 200,
      'Review page works',
    );
    await form(
      `/works/${id}/publish`,
      { revision: '1', reviewed: 'yes', share_to_feed: 'yes' },
      owner.cookie,
    );
    const page = await (await fetch(origin + `/u/local-maker/works/${id}`)).text();
    check(page.includes(data.title), 'Published title');
    check(!page.includes('担当の判断と確認事項（非公開）'), 'Assessment hidden');
    for (const s of data.sources) check(!page.includes(s.note), 'Evidence notes hidden');
    for (const image of images)
      check(
        (await fetch(origin + `/assets/${image}`)).status === 200,
        'Selected image is public only after review',
      );
    imported.push({ id, title: data.title, basis: data.assessment?.basis });
  }
  check((await call('list_works')).works.length === fixture.length, 'No duplicate works');
  const first = imported[0].id,
    initial = store.work(owner.user.id, first);
  const manual = {
    ...initial.data,
    summary: initial.data.summary + ' 制作の記録として整理しました。',
  };
  const update = await fetch(origin + `/v1/works/${first}`, {
    method: 'PUT',
    headers: { Origin: origin, Cookie: owner.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_revision: 1, work: manual }),
  });
  check(update.ok, 'Owner edits draft');
  check(
    !(await (await fetch(origin + `/u/local-maker/works/${first}`)).text()).includes(
      '制作の記録として整理しました。',
    ),
    'Draft edit does not mutate publication',
  );
  const current = (await call('get_work', { work_id: first })).work;
  const proposal = await call('propose_work_changes', {
    work_id: first,
    base_revision: current.revision,
    work: {
      ...current.data,
      ingenuity: current.data.ingenuity + ' 複数の資料を照合して内容を整理しました。',
    },
  });
  check(store.work(owner.user.id, first).revision === 2, 'Agent cannot silently overwrite');
  await form(`/proposals/${proposal.proposal_id}/accept`, {}, owner.cookie);
  check(
    store.work(owner.user.id, first).data.summary === manual.summary,
    'Manual editing preserved',
  );
  await form(
    `/works/${first}/publish`,
    { revision: '3', reviewed: 'yes', share_to_feed: 'yes' },
    owner.cookie,
  );
  await form(
    `/social/works/${first}/questions`,
    { body: '役割を分けるときに工夫したことを知りたいです。' },
    peer.cookie,
  );
  const q = social.questions(first)[0];
  await form(
    `/social/questions/${q.id}/answer`,
    { answer: '資料同士の整合を確認する役割を分けました。' },
    owner.cookie,
  );
  await form(
    `/social/works/${first}/invitations`,
    {
      event_title: 'ローカル検証用LT（架空）',
      event_url: 'https://example.test/local-lt',
      purpose: '設計経験を紹介する発表を一緒に準備したいです。',
      sender_role: '発表の構成',
      recipient_role: '要件定義の事例紹介',
      next_step: '候補の題材を一つ選びます。',
    },
    peer.cookie,
  );
  const invitation = social.invitations(owner.user.id)[0];
  await form(`/social/invitations/${invitation.id}/state`, { state: 'accepted' }, owner.cookie);
  await form(
    `/social/invitations/${invitation.id}/contact`,
    { contact: 'https://example.test/local-peer' },
    peer.cookie,
  );
  check(
    social.invitations(owner.user.id)[0].sender_contact === 'https://example.test/local-peer',
    'Accepted contact visible to recipient',
  );
  const event = await form(
    '/opportunities',
    {
      title: 'ローカル検証用ハッカソン（架空）',
      url: 'https://example.test/local-hackathon',
      date: '2026-12-12',
      deadline: '2026-12-01',
      location: 'オンライン',
      conditions: 'テスト用。募集情報ではありません。',
      existing_work: 'forbidden',
    },
    owner.cookie,
  );
  check(
    (await fetch(origin + event.headers.get('location'), { headers: { Cookie: owner.cookie } }))
      .status === 200,
    'Opportunity detail works',
  );
  check(social.notices(owner.user.id).length >= 2, 'Questions and invitations arrive');
  await form(`/works/${first}/withdraw`, {}, owner.cookie);
  check(
    (await fetch(origin + `/u/local-maker/works/${first}`)).status === 404,
    'Publication can be withdrawn',
  );
  check(social.invitations(peer.user.id).length === 0, 'Withdraw hides related invitations');
  await form(
    `/works/${first}/publish`,
    { revision: '3', reviewed: 'yes', share_to_feed: 'yes' },
    owner.cookie,
  );
  check(
    social.invitations(owner.user.id)[0].sender_contact === '',
    'Withdraw permanently revokes exchanged contacts',
  );
  store.revoke(owner.user.id, token.id);
  check(
    (await client.callTool({ name: 'list_works', arguments: {} })).isError,
    'Revoked token fails',
  );
  await client.close();
  await transport.close();
  transport = undefined;
  await server.stop(true);
  store.close();
  const reopened = new Store(join(directory, 'app.sqlite'));
  check(reopened.works(owner.user.id).length === fixture.length, 'Persistence after restart');
  reopened.close();
  const report = {
    checks,
    directory,
    works: imported,
    scope:
      'Local real-material MCP and HTTP verification. No public deployment. Claude API not called.',
  };
  await Bun.write(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close().catch(() => {});
  if (transport) await transport.close();
  await server.stop(true);
  try {
    store.close();
  } catch {}
}
