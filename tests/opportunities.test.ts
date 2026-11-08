import { expect, test } from 'bun:test';
import { Store } from '../src/store';
import { Opportunities, opportunitySchema } from '../src/opportunities';
import { workSchema } from '../src/schema';

const event = opportunitySchema.parse({
  title: 'ハッカソン',
  url: 'https://example.test/event',
  date: '2026-12-12',
  deadline: '2026-12-01',
  location: 'オンライン',
  conditions: '高専生。公式条件の再確認が必要です。',
  existing_work: 'forbidden',
});
async function setup() {
  const store = new Store();
  const user = await store.register({
    email: 'test@example.test',
    password: 'test-password-123',
    display_name: 'Test',
    handle: 'test-user',
    school: 'PRIVATE_SCHOOL',
    department: '',
    grade: '',
  });
  const work = store.createWork(
    user.id,
    'test',
    workSchema.parse({
      title: '試作',
      summary: '回路の試作です。',
      kind: 'coursework',
      year: null,
      status: 'prototype',
      team_result: '',
      my_roles: ['担当未確認'],
      my_contribution: '担当は未確認です。',
      ingenuity: '',
      outcome: '',
      next_interest: '',
      tags: [],
      asset_ids: [],
      sources: [{ label: 'PRIVATE_SOURCE', note: 'PRIVATE_NOTE' }],
      assessment: { basis: 'unknown', evidence: 'PRIVATE_EVIDENCE', uncertainties: [] },
    }),
  ).work;
  return { store, user, work };
}
test('機会は本人だけが保存と状態変更。保存は応募を意味しない', async () => {
  const { store, user } = await setup();
  try {
    const op = new Opportunities(store),
      id = op.add(user.id, event);
    expect(op.get(user.id, id).state).toBe('saved');
    expect(op.add(user.id, event)).toBe(id);
    expect(() => op.get('someone', id)).toThrow();
    op.setState(user.id, id, 'applied');
    expect(op.get(user.id, id).state).toBe('applied');
    op.edit(user.id, id, { ...event, title: '更新' });
    expect(op.get(user.id, id).title).toBe('更新');
    expect(opportunitySchema.safeParse({ ...event, date: '2026-02-30' }).success).toBe(false);
    expect(op.enabled()).toBe(false);
    await expect(op.recommend(user.id, id, [])).rejects.toThrow('AIの接続');
  } finally {
    store.close();
  }
});
test('Claudeの入力に根拠と学校情報を送らず既存作品禁止を渡す。再利用と利用量を記録', async () => {
  const { store, user, work } = await setup();
  let calls = 0;
  try {
    const op = new Opportunities(store, {
      key: 'test-key',
      fetch: async (_url, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        expect(String(init?.body)).not.toContain('PRIVATE_');
        expect(body.messages[0].content).toContain('forbidden');
        expect(body.tools[0].name).toBe('prepare_activity');
        return Response.json({
          content: [
            {
              type: 'tool_use',
              name: 'prepare_activity',
              input: {
                reason: '回路の経験を使えます。',
                work_ids: [work.id],
                role: '役割を確認してから相談します。',
                project_idea: '新しい題材を制作します。',
                checks: ['参加資格と締切を公式情報で確認します。'],
                steps: ['新規の制作案をまとめます。'],
              },
            },
          ],
          usage: { input_tokens: 120, output_tokens: 70 },
        });
      },
    });
    const id = op.add(user.id, event);
    await op.recommend(user.id, id, [work.id]);
    expect(op.latest(user.id, id)?.state).toBe('completed');
    expect(op.latest(user.id, id)?.input_tokens).toBe(120);
    await op.recommend(user.id, id, [work.id]);
    expect(calls).toBe(1);
    expect(op.latest(user.id, id)?.stale).toBe(false);
    store.updateWork(user.id, work.id, 1, { ...work.data, summary: '改訂しました。' });
    expect(op.latest(user.id, id)?.stale).toBe(true);
    await op.recommend(user.id, id, [work.id]);
    expect(op.latest(user.id, id)?.stale).toBe(false);
    expect(calls).toBe(2);
  } finally {
    store.close();
  }
});
test('Claudeの失敗と未知の作品IDを記録して再試行可能。キーや生レスポンスを保存しない', async () => {
  const { store, user, work } = await setup();
  try {
    const op = new Opportunities(store, {
      key: 'SECRET_TEST_KEY',
      fetch: async () =>
        Response.json({
          content: [
            {
              type: 'tool_use',
              name: 'prepare_activity',
              input: {
                reason: '理由',
                work_ids: ['unknown'],
                role: '役割',
                project_idea: '案',
                checks: ['条件'],
                steps: ['作業'],
              },
            },
          ],
        }),
    });
    const id = op.add(user.id, event);
    await op.recommend(user.id, id, [work.id]);
    expect(op.latest(user.id, id)?.state).toBe('failed');
    expect(JSON.stringify(op.latest(user.id, id))).not.toContain('SECRET');
    op.claude.fetch = async () => new Response('provider private response', { status: 429 });
    await op.recommend(user.id, id, [work.id]);
    expect(op.latest(user.id, id)?.error).not.toContain('provider private');
    await expect(
      op.recommend(user.id, id, ['00000000-0000-4000-8000-000000000000']),
    ).rejects.toThrow();
  } finally {
    store.close();
  }
});

test('処理中の重複要求と利用上限。中断後は再試行を案内する', async () => {
  const { store, user, work } = await setup();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const op = new Opportunities(store, {
      key: 'test-key',
      fetch: async () => {
        await gate;
        return new Response('unavailable', { status: 503 });
      },
    });
    const id = op.add(user.id, event),
      pending = op.recommend(user.id, id, [work.id]);
    await expect(op.recommend(user.id, id, [work.id])).rejects.toThrow('準備案を作成しています');
    release();
    await pending;
    store.db
      .query("UPDATE opportunity_advice SET state='running',created_at=?")
      .run(new Date(Date.now() - 120000).toISOString());
    expect(op.latest(user.id, id)?.state).toBe('failed');
    expect(op.latest(user.id, id)?.error).toContain('中断');
    op.claude.fetch = async () => new Response('unavailable', { status: 503 });
    for (let i = 0; i < 9; i++) await op.recommend(user.id, id, [work.id]);
    await expect(op.recommend(user.id, id, [work.id])).rejects.toThrow('利用上限');
  } finally {
    release();
    store.close();
  }
});
