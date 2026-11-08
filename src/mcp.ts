import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createWorkSchema, updateWorkSchema } from './schema';

const base = new URL(process.env.KOSEN_LAUNCH_URL ?? 'http://127.0.0.1:4177');
const token = process.env.KOSEN_LAUNCH_TOKEN;
if (!token) throw new Error('KOSEN_LAUNCH_TOKENを設定してください。');
if (
  base.username ||
  base.password ||
  (base.protocol !== 'https:' &&
    !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
) {
  throw new Error('接続先はHTTPSまたはローカルのHTTPを指定してください。');
}
async function request(path: string, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(path, base.origin), {
    method,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(
      typeof data.error === 'string' ? data.error : 'サービスへの接続を確認してください。',
    );
  return data;
}
async function result(action: () => Promise<unknown>) {
  try {
    return { content: [{ type: 'text' as const, text: JSON.stringify(await action()) }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: error instanceof Error ? error.message : '操作を完了できませんでした。',
        },
      ],
    };
  }
}
const idSchema = z.object({ work_id: z.string().uuid() });
serveStdio(() => {
  const server = new McpServer({ name: 'kosen-launch', version: '0.1.0' });
  server.registerTool(
    'get_authoring_rules',
    {
      description: '作品Schemaと制作ルールを取得します。作成前に必ず読みます。',
      inputSchema: z.object({}),
    },
    () => result(() => request('/v1/authoring-rules')),
  );
  server.registerTool(
    'get_profile',
    {
      description: '本人のhandleと表示名を取得します。資料の記名との照合に使います。',
      inputSchema: z.object({}),
    },
    () =>
      result(async () => {
        const { user } = (await request('/v1/me')) as {
          user: { handle: string; display_name: string };
        };
        return { handle: user.handle, display_name: user.display_name };
      }),
  );
  server.registerTool(
    'list_works',
    { description: '本人の作品と現在の版を取得し重複作成を防ぎます。', inputSchema: z.object({}) },
    () => result(() => request('/v1/works')),
  );
  server.registerTool(
    'get_work',
    { description: '作品の最新版と本人用のプレビューURLを取得します。', inputSchema: idSchema },
    ({ work_id }) => result(() => request(`/v1/works/${work_id}`)),
  );
  server.registerTool(
    'create_work_draft',
    {
      description: '新しい作品を非公開の下書きとして作成します。同じsource_keyは重複作成しません。',
      inputSchema: createWorkSchema,
    },
    (args) => result(() => request('/v1/works', 'POST', args)),
  );
  server.registerTool(
    'propose_work_changes',
    {
      description:
        '既存作品への更新案を送信します。本人が採用するまで下書きも公開版も変更しません。',
      inputSchema: updateWorkSchema.extend({ work_id: z.string().uuid() }),
    },
    ({ work_id, ...input }) =>
      result(() => request(`/v1/works/${work_id}/proposals`, 'POST', input)),
  );
  server.registerTool(
    'upload_image',
    {
      description:
        '利用者が選んだローカル画像を非公開で送信します。PNG・JPEG・WebPで5MB以内。絶対パスを作品本文に含めません。',
      inputSchema: z.object({ file_path: z.string().min(1), alt: z.string().min(1).max(200) }),
    },
    ({ file_path, alt }) =>
      result(async () => {
        const file = Bun.file(file_path);
        if (!(await file.exists()) || !file.size || file.size > 5 * 1024 * 1024)
          throw new Error('5MB以内の画像ファイルを指定してください。');
        const form = new FormData();
        form.set('image', file, 'image');
        form.set('alt', alt);
        return request('/v1/assets', 'POST', form);
      }),
  );
  server.registerTool(
    'prepare_publication',
    {
      description: '本人が確認するWeb画面のURLを返します。公開操作は行いません。',
      inputSchema: idSchema,
    },
    ({ work_id }) => result(() => request(`/v1/works/${work_id}/publication-reviews`, 'POST')),
  );
  return server;
});
