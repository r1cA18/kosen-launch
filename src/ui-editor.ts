import { relative, resolve } from 'node:path';
import { z } from 'zod';

// Local-only UI copy editor. Each change rewrites the matching literal in src/ so the
// edit becomes an ordinary source diff; nothing is stored at runtime.

const changeSchema = z
  .object({
    from: z.string().trim().min(1).max(500),
    to: z.string().trim().min(1).max(500),
    all: z.boolean().default(false),
  })
  .strict();
export const applySchema = z.object({ changes: z.array(changeSchema).min(1).max(50) }).strict();
export type ChangeResult = {
  from: string;
  to: string;
  status: 'applied' | 'ambiguous' | 'not_found' | 'invalid';
  locations: string[];
  message: string;
};

const forbidden = /[{}<>'"`\\\n]/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const opening = new Set(['>', "'", '"', '`', '}']);
const closing = new Set(['<', "'", '"', '`', '{', '$']);

function locate(text: string, from: string) {
  const pattern = new RegExp(escape(from).replace(/\s+/g, '\\s+'), 'g');
  const spans: { start: number; end: number }[] = [];
  for (const m of text.matchAll(pattern)) {
    const start = m.index!,
      end = start + m[0].length;
    let before = start - 1;
    while (before >= 0 && /\s/.test(text[before])) before--;
    let after = end;
    while (after < text.length && /\s/.test(text[after])) after++;
    if (opening.has(text[before]) && closing.has(text[after])) spans.push({ start, end });
  }
  return spans;
}
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

export class UiEditor {
  constructor(
    private root: string,
    private formatter?: (files: string[]) => Promise<void>,
  ) {}
  private async files() {
    const result: { path: string; text: string }[] = [];
    for await (const file of new Bun.Glob('src/**/*.{ts,tsx}').scan({ cwd: this.root })) {
      if (file.endsWith('ui-editor.ts')) continue;
      const path = resolve(this.root, file);
      result.push({ path, text: await Bun.file(path).text() });
    }
    return result;
  }
  async apply(input: z.infer<typeof applySchema>): Promise<ChangeResult[]> {
    const { results, write } = await this.plan(input);
    await write();
    return results;
  }
  // Results are known before writing so a watch-mode restart cannot drop the response.
  async plan(input: z.infer<typeof applySchema>) {
    const files = await this.files();
    const originals = new Map(files.map((f) => [f.path, f.text]));
    const changed = new Set<string>();
    const results: ChangeResult[] = [];
    for (const change of input.changes) {
      const base = { from: change.from, to: change.to, locations: [] as string[] };
      if (forbidden.test(change.to)) {
        results.push({
          ...base,
          status: 'invalid',
          message: '記号 { } < > \' " ` \\ と改行は使えません。言い換えてください。',
        });
        continue;
      }
      const hits = files.flatMap((f) =>
        locate(f.text, change.from).map((span) => ({ file: f, span })),
      );
      const locations = hits.map(
        (h) => `${relative(this.root, h.file.path)}:${lineOf(h.file.text, h.span.start)}`,
      );
      if (!hits.length) {
        results.push({
          ...base,
          status: 'not_found',
          message:
            'ソースに同じ文言が見つかりません。数値や入力データを含む文字列は、ここでは変更できません。',
        });
        continue;
      }
      if (hits.length > 1 && !change.all) {
        results.push({
          ...base,
          locations,
          status: 'ambiguous',
          message: `同じ文言が${hits.length}か所にあります。すべて変更するか確認してください。`,
        });
        continue;
      }
      for (const file of new Set(hits.map((h) => h.file))) {
        const spans = hits
          .filter((h) => h.file === file)
          .map((h) => h.span)
          .sort((a, b) => b.start - a.start);
        for (const span of spans)
          file.text = file.text.slice(0, span.start) + change.to + file.text.slice(span.end);
        changed.add(file.path);
      }
      results.push({
        ...base,
        locations,
        status: 'applied',
        message: `${hits.length}か所を変更しました。`,
      });
    }
    const write = async () => {
      for (const file of files)
        if (changed.has(file.path) && file.text !== originals.get(file.path))
          await Bun.write(file.path, file.text);
      if (changed.size && this.formatter) await this.formatter([...changed]);
    };
    return { results, write };
  }
}

export async function prettier(root: string, files: string[]) {
  const process = Bun.spawn([resolve(root, 'node_modules/.bin/prettier'), '--write', ...files], {
    cwd: root,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await process.exited;
}
