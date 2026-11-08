import { McpServer } from '@modelcontextprotocol/server';
import { SkillCatalog, memorySkillFiles } from '@modelcontextprotocol/server/ext/skills';
import { z } from 'zod';
import { createWorkSchema, updateWorkSchema } from './schema';

/** Calls the Kosen Launch HTTP API as the connected person and returns the JSON body. */
export type Api = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;
export type McpOptions = {
  /** stdio may read a local image path; the remote endpoint must never read server files. */
  localFiles: boolean;
  /** Served through the MCP Skills extension so the connector also delivers the Skill. */
  skills?: Promise<SkillCatalog | undefined>;
};

export const remoteImageLimit = 2 * 1024 * 1024;

/** Builds an Api that answers from a fetch handler with the caller's Bearer token. */
export function fetchApi(
  fetcher: (request: Request) => Response | Promise<Response>,
  origin: string,
  token: string,
): Api {
  return async (path, method = 'GET', body) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetcher(
      new Request(new URL(path, origin), {
        method,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      }),
    );
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok)
      throw new Error(
        typeof data.error === 'string' ? data.error : 'サービスへの接続を確認してください。',
      );
    return data;
  };
}

export function loadSkillCatalog(skill: string | undefined) {
  if (!skill) return Promise.resolve(undefined);
  return SkillCatalog.load(memorySkillFiles({ 'kosen-portfolio/SKILL.md': skill }), {
    onWarning: () => {},
  }).catch(() => undefined);
}

/** Decodes a base64 image (optionally a data URL) and checks size and magic bytes. */
export function decodeImage(data: string) {
  const raw = data.replace(/^data:image\/[a-z]+;base64,/i, '').replace(/\s+/g, '');
  if (
    !raw ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) ||
    raw.length > Math.ceil(remoteImageLimit / 3) * 4
  )
    throw new Error('2MB以内のPNG・JPEG・WebPをbase64で指定してください。');
  const bytes = new Uint8Array(Buffer.from(raw, 'base64'));
  if (!bytes.length || bytes.length > remoteImageLimit)
    throw new Error('2MB以内のPNG・JPEG・WebPをbase64で指定してください。');
  const text = (from: number, to: number) => new TextDecoder().decode(bytes.slice(from, to));
  const mime = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
    ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? 'image/jpeg'
      : text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP'
        ? 'image/webp'
        : null;
  if (!mime) throw new Error('PNG・JPEG・WebPの画像を指定してください。');
  return new File([bytes], 'image', { type: mime });
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
const alt = z.string().min(1).max(200);
const imageData = z
  .string()
  .min(1)
  .max(Math.ceil(remoteImageLimit / 3) * 4 + 64)
  .describe('画像のbase64。PNG・JPEG・WebPで2MB以内。');

/** The tools shared by the stdio adapter and the remote /mcp endpoint. */
export async function createMcpServer(api: Api, options: McpOptions) {
  const server = new McpServer({ name: 'kosen-launch', version: '0.1.0' });
  server.registerTool(
    'get_authoring_rules',
    {
      description: '作品Schemaと制作ルールを取得します。作成前に必ず読みます。',
      inputSchema: z.object({}),
    },
    () => result(() => api('/v1/authoring-rules')),
  );
  server.registerTool(
    'get_profile',
    {
      description: '本人のhandleと表示名を取得します。資料の記名との照合に使います。',
      inputSchema: z.object({}),
    },
    () =>
      result(async () => {
        const { user } = (await api('/v1/me')) as {
          user: { handle: string; display_name: string };
        };
        return { handle: user.handle, display_name: user.display_name };
      }),
  );
  server.registerTool(
    'list_works',
    { description: '本人の作品と現在の版を取得し重複作成を防ぎます。', inputSchema: z.object({}) },
    () => result(() => api('/v1/works')),
  );
  server.registerTool(
    'get_work',
    { description: '作品の最新版と本人用のプレビューURLを取得します。', inputSchema: idSchema },
    ({ work_id }) => result(() => api(`/v1/works/${work_id}`)),
  );
  server.registerTool(
    'create_work_draft',
    {
      description: '新しい作品を非公開の下書きとして作成します。同じsource_keyは重複作成しません。',
      inputSchema: createWorkSchema,
    },
    (args) => result(() => api('/v1/works', 'POST', args)),
  );
  server.registerTool(
    'propose_work_changes',
    {
      description:
        '既存作品への更新案を送信します。本人が採用するまで下書きも公開版も変更しません。',
      inputSchema: updateWorkSchema.extend({ work_id: z.string().uuid() }),
    },
    ({ work_id, ...input }) => result(() => api(`/v1/works/${work_id}/proposals`, 'POST', input)),
  );
  const send = (file: Blob, description: string) => {
    const form = new FormData();
    form.set('image', file, 'image');
    form.set('alt', description);
    return api('/v1/assets', 'POST', form);
  };
  if (options.localFiles)
    server.registerTool(
      'upload_image',
      {
        description:
          '利用者が選んだ画像を非公開で送信します。file_path（5MB以内）かdata（base64で2MB以内）のどちらかを指定します。PNG・JPEG・WebPに対応します。絶対パスを作品本文に含めません。',
        inputSchema: z
          .object({ file_path: z.string().min(1).optional(), data: imageData.optional(), alt })
          .refine(
            (v) => !!v.file_path !== !!v.data,
            'file_pathかdataのどちらかを指定してください。',
          ),
      },
      ({ file_path, data, alt }) =>
        result(async () => {
          if (data) return send(decodeImage(data), alt);
          const file = Bun.file(file_path!);
          if (!(await file.exists()) || !file.size || file.size > 5 * 1024 * 1024)
            throw new Error('5MB以内の画像ファイルを指定してください。');
          return send(file, alt);
        }),
    );
  else
    server.registerTool(
      'upload_image',
      {
        description:
          '利用者が会話に添付した画像をbase64で非公開に送信します。PNG・JPEG・WebPで2MB以内。大きい画像は縮小してから送ります。',
        inputSchema: z.object({ data: imageData, alt }),
      },
      ({ data, alt }) => result(() => send(decodeImage(data), alt)),
    );
  server.registerTool(
    'prepare_publication',
    {
      description: '本人が確認するWeb画面のURLを返します。公開操作は行いません。',
      inputSchema: idSchema,
    },
    ({ work_id }) => result(() => api(`/v1/works/${work_id}/publication-reviews`, 'POST')),
  );
  (await options.skills)?.attach(server);
  return server;
}
