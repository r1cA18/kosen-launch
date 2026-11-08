import { expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store';
import { createApp } from '../src/app';

test('実stdio MCPでルール取得から下書き作成・更新案・公開準備まで', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kosen-mcp-'));
  const store = new Store();
  const user = await store.register({
    email: 'mcp@example.test',
    password: 'test-password-123',
    display_name: 'MCP',
    handle: 'mcp-user',
    school: '',
    department: '',
    grade: '',
  });
  const token = store.createToken(user.id, 'SDK test').token;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('starting', { status: 503 }),
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const app = createApp(store, {
    origin,
    assetDirectory: dir,
    staticDirectory: resolve('public'),
    skillPath: resolve('skills/kosen-portfolio/SKILL.md'),
  });
  server.reload({ fetch: app.fetch });
  const client = new Client({ name: 'kosen-integration', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('src/mcp.ts')],
    env: { KOSEN_LAUNCH_URL: origin, KOSEN_LAUNCH_TOKEN: token },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(7);
    expect(tools.tools.some((t) => t.name === 'publish')).toBe(false);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      const content = result.content as { type: string; text: string }[];
      return JSON.parse(content[0].text);
    };
    const rules = await call('get_authoring_rules');
    expect(rules.version).toBe('1');
    const imagePath = join(dir, 'test.png');
    await Bun.write(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const uploaded = await call('upload_image', { file_path: imagePath, alt: 'SDK画像テスト' });
    const work = {
      title: 'MCPから作成',
      summary: 'MCPの実接続で作成した作品です。',
      kind: 'personal',
      year: null,
      status: 'prototype',
      team_result: '',
      my_roles: ['実装'],
      my_contribution: '試作しました。',
      ingenuity: '',
      outcome: '',
      next_interest: '',
      tags: [],
      asset_ids: [uploaded.asset_id],
      sources: [],
    };
    const created = await call('create_work_draft', { source_key: 'sdk-test', work });
    expect(created.created).toBe(true);
    expect((await call('list_works')).works).toHaveLength(1);
    expect((await call('get_work', { work_id: created.work.id })).work.data.title).toBe(work.title);
    await call('propose_work_changes', {
      work_id: created.work.id,
      base_revision: 1,
      work: { ...work, title: '更新案' },
    });
    expect(store.work(user.id, created.work.id).revision).toBe(1);
    const review = await call('prepare_publication', { work_id: created.work.id });
    expect(review.review_url).toBe(`${origin}/works/${created.work.id}/review`);
    expect(store.published()).toHaveLength(0);
    expect((await fetch(`${origin}/assets/${uploaded.asset_id}`)).status).toBe(404);
    store.revoke(user.id, store.tokens(user.id)[0].id);
    expect((await client.callTool({ name: 'list_works', arguments: {} })).isError).toBe(true);
  } finally {
    await client.close();
    await transport.close();
    await server.stop(true);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
