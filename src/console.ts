import type { WorkData } from './schema';

export const textFields = [
  ['title', '作品名'],
  ['summary', 'どんな作品か'],
  ['my_contribution', '自分が担当したこと'],
  ['team_result', 'チームで作ったもの'],
  ['ingenuity', '工夫したこと'],
  ['outcome', '結果と学んだこと'],
  ['next_interest', '次にしてみたいこと'],
] as const;
export const listFields = [
  ['my_roles', '担当した役割'],
  ['tags', 'タグ'],
] as const;
export type TextField = (typeof textFields)[number][0];
export type ListField = (typeof listFields)[number][0];
export type EditableField = TextField | ListField;
export const fieldLabel = (field: string) =>
  [...textFields, ...listFields].find(([f]) => f === field)?.[1] ?? field;
export const isEditableField = (field: string): field is EditableField =>
  [...textFields, ...listFields].some(([f]) => f === field);

const names: [RegExp, string][] = [
  [/\bjavascript\b/gi, 'JavaScript'],
  [/\btypescript\b/gi, 'TypeScript'],
  [/\bgithub\b/gi, 'GitHub'],
  [/\bgitlab\b/gi, 'GitLab'],
  [/\biot\b/gi, 'IoT'],
  [/\bpython\b/gi, 'Python'],
  [/\barduino\b/gi, 'Arduino'],
  [/\braspberry ?pi\b/gi, 'Raspberry Pi'],
  [/\bfigma\b/gi, 'Figma'],
  [/\bunity\b/gi, 'Unity'],
  [/\bdiscord\b/gi, 'Discord'],
  [/\bnode\.?js\b/gi, 'Node.js'],
  [/\breact\b/gi, 'React'],
];
type Rule = { id: string; label: string; fix: (s: string) => string };
const rules: Rule[] = [
  {
    id: 'fullwidth-alnum',
    label: '全角の英数字を半角にします',
    fix: (s) =>
      s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)),
  },
  {
    id: 'halfwidth-kana',
    label: '半角カタカナを全角にします',
    fix: (s) => s.replace(/[ｦ-ﾟ]+/g, (m) => m.normalize('NFKC')),
  },
  {
    id: 'product-name',
    label: '製品名や技術名の大文字・小文字をそろえます',
    fix: (s) => names.reduce((v, [pattern, name]) => v.replace(pattern, name), s),
  },
  {
    id: 'spaces',
    label: '連続した空白と行末の空白を整理します',
    fix: (s) =>
      s
        .replace(/[ 　]{2,}/g, ' ')
        .replace(/[ 　]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n'),
  },
  {
    id: 'jp-space',
    label: '日本語と英数字の間の空白を詰めます',
    fix: (s) =>
      s
        .replace(/([぀-ヿ一-鿿])[ 　]+([A-Za-z0-9])/g, '$1$2')
        .replace(/([A-Za-z0-9])[ 　]+([぀-ヿ一-鿿])/g, '$1$2'),
  },
  {
    id: 'punctuation',
    label: '句読点を「、」「。」にそろえます',
    fix: (s) => s.replace(/，/g, '、').replace(/．/g, '。'),
  },
];
const plainStyle = /(?:だ|である|した|する|できた|なった|思う)。/;

export type Issue = {
  field: EditableField;
  rule: string;
  label: string;
  before: string;
  after?: string;
};
const clip = (s: string, from: number, to: number) => {
  const stop = Math.min(s.length, to + 16);
  return (from ? '…' : '') + s.slice(from, stop) + (stop < s.length ? '…' : '');
};
const excerpt = (before: string, after: string) => {
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  const from = Math.max(0, start - 16);
  return {
    before: clip(before, from, before.length - end),
    after: clip(after, from, after.length - end),
  };
};
const fieldText = (data: WorkData, field: EditableField) =>
  field === 'my_roles' || field === 'tags' ? data[field].join('、') : data[field];

export function checkWork(data: WorkData): Issue[] {
  const issues: Issue[] = [];
  for (const [field] of [...textFields, ...listFields]) {
    const value = fieldText(data, field);
    if (!value) continue;
    for (const rule of rules) {
      const fixed = rule.fix(value);
      if (fixed !== value)
        issues.push({ field, rule: rule.id, label: rule.label, ...excerpt(value, fixed) });
    }
    if (field !== 'title' && plainStyle.test(value)) {
      const sentence = value.split(/(?<=。)/).find((s) => plainStyle.test(s)) ?? '';
      issues.push({
        field,
        rule: 'plain-style',
        label: 'です・ます調でない文があります。文末を確認してください',
        before: sentence.trim().slice(-40),
      });
    }
  }
  return issues;
}
const setField = (data: WorkData, field: EditableField, fn: (s: string) => string): WorkData =>
  field === 'my_roles' || field === 'tags'
    ? {
        ...data,
        [field]: [
          ...new Set(
            data[field]
              .map(fn)
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ],
      }
    : { ...data, [field]: fn(data[field]) };

export function applyFix(data: WorkData, field: EditableField, ruleId: string): WorkData {
  const rule = rules.find((r) => r.id === ruleId);
  return rule ? setField(data, field, rule.fix) : data;
}
export function applyAllFixes(data: WorkData): WorkData {
  return [...textFields, ...listFields].reduce(
    (d, [field]) => rules.reduce((v, rule) => setField(v, field, rule.fix), d),
    data,
  );
}

export type Match = { field: EditableField; count: number; before: string; after: string };
export function findMatches(data: WorkData, find: string, replacement: string): Match[] {
  if (!find) return [];
  const matches: Match[] = [];
  for (const [field] of [...textFields, ...listFields]) {
    const value = fieldText(data, field);
    const count = value.split(find).length - 1;
    if (count)
      matches.push({ field, count, ...excerpt(value, value.replaceAll(find, replacement)) });
  }
  return matches;
}
export function replaceAll(data: WorkData, find: string, replacement: string): WorkData {
  return [...textFields, ...listFields].reduce(
    (d, [field]) => setField(d, field, (s) => s.replaceAll(find, replacement)),
    data,
  );
}
