import type { User, Work, Store } from './store';
import { kindLabels, statusLabels } from './schema';
import { Layout, PageHeading } from './ui';
import {
  checkWork,
  fieldLabel,
  findMatches,
  listFields,
  textFields,
  type EditableField,
} from './console';

function Editable({
  field,
  value,
  tag = 'p',
}: {
  field: EditableField;
  value: string;
  tag?: 'h1' | 'p';
}) {
  const props = {
    class: 'console-editable',
    contenteditable: 'plaintext-only' as const,
    role: 'textbox',
    'aria-multiline': tag === 'p' ? 'true' : 'false',
    'aria-label': fieldLabel(field),
    'data-field': field,
    'data-placeholder': `${fieldLabel(field)}を入力してください`,
    spellcheck: true,
  };
  return tag === 'h1' ? <h1 {...props}>{value}</h1> : <p {...props}>{value}</p>;
}

export function ConsolePage({
  user,
  work,
  store,
  notice,
}: {
  user: User;
  work: Work;
  store: Store;
  notice?: string;
}) {
  const d = work.data;
  const issues = checkWork(d);
  const value = (field: EditableField) =>
    field === 'my_roles' || field === 'tags' ? d[field].join('、') : d[field];
  return (
    <Layout title={`${d.title}の編集`} user={user} active="works">
      <div class="console" data-console>
        <header class="console-bar">
          <div>
            <a class="back-link" href={`/works/${work.id}`}>
              入力フォームで編集する
            </a>
            <h1>編集コンソール</h1>
            <p class="quiet">
              編集版 {work.revision} /{' '}
              {work.published_revision
                ? `公開版 ${work.published_revision}`
                : 'まだ公開されていません'}
              <span class="console-dirty" data-dirty-label hidden>
                未保存の変更があります
              </span>
            </p>
          </div>
          <div class="actions">
            <a class="btn btn-outline" href={`/works/${work.id}/review`}>
              公開前に確認
            </a>
            <button class="btn btn-primary" form="console-form" data-save>
              保存
            </button>
          </div>
        </header>
        {notice && (
          <p class="alert alert-success" role="status">
            {notice}
          </p>
        )}
        <noscript>
          <p class="alert alert-warning">
            文章を直接編集するにはJavaScriptを有効にしてください。入力フォームからも編集できます。
          </p>
        </noscript>
        <form id="console-form" method="post" action={`/works/${work.id}/save`}>
          <input type="hidden" name="revision" value={work.revision} />
          <input type="hidden" name="return" value="console" />
          {[...textFields, ...listFields].map(([field]) => (
            <input type="hidden" name={field} value={value(field)} data-field-input={field} />
          ))}
        </form>
        <div class="console-layout">
          <section class="console-canvas" aria-label="公開ページの見た目で編集">
            <p class="preview-label">文章をクリックすると、その場で書き換えられます</p>
            <div class="public-work console-paper">
              <article class="work-detail">
                <div class="tags">
                  <span class="badge badge-ghost">{kindLabels[d.kind]}</span>
                  <span class="badge badge-ghost">{statusLabels[d.status]}</span>
                  <span class="badge badge-ghost">{d.year ?? '制作年未確認'}</span>
                </div>
                <Editable field="title" value={d.title} tag="h1" />
                <div class="work-summary">
                  <Editable field="summary" value={d.summary} />
                </div>
                {d.asset_ids.length > 0 && (
                  <div class="gallery">
                    {d.asset_ids.map((id) => (
                      <img
                        src={`/assets/${id}`}
                        alt={store.asset(id, user.id).alt}
                        loading="lazy"
                      />
                    ))}
                  </div>
                )}
                <section>
                  <h2>自分が担当したこと</h2>
                  <div class="console-list">
                    <span class="quiet">役割（「、」区切り）</span>
                    <Editable field="my_roles" value={value('my_roles')} />
                  </div>
                  <Editable field="my_contribution" value={d.my_contribution} />
                </section>
                {textFields
                  .filter(([f]) => !['title', 'summary', 'my_contribution'].includes(f))
                  .map(([field, label]) => (
                    <section>
                      <h2>{label}</h2>
                      <Editable field={field} value={value(field)} />
                    </section>
                  ))}
                <section>
                  <h2>タグ</h2>
                  <div class="console-list">
                    <span class="quiet">「、」区切り</span>
                    <Editable field="tags" value={value('tags')} />
                  </div>
                </section>
              </article>
            </div>
          </section>
          <aside class="console-panel">
            <section class="card console-card">
              <h2>作品の情報</h2>
              <label class="field">
                <span>制作の種類</span>
                <select class="select" name="kind" form="console-form" data-watch>
                  {Object.entries(kindLabels).map(([v, label]) => (
                    <option value={v} selected={v === d.kind}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span>制作年（不明なら空欄）</span>
                <input
                  class="input"
                  type="number"
                  name="year"
                  min={2000}
                  max={2100}
                  value={d.year ?? ''}
                  form="console-form"
                  data-watch
                />
              </label>
              <label class="field">
                <span>制作の状態</span>
                <select class="select" name="status" form="console-form" data-watch>
                  {Object.entries(statusLabels).map(([v, label]) => (
                    <option value={v} selected={v === d.status}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </section>
            <section class="card console-card" aria-live="polite">
              <div class="console-card-heading">
                <h2>表記チェック</h2>
                <span class="badge badge-ghost">{issues.length}件</span>
              </div>
              <p class="quiet" data-fix-note hidden>
                修正を適用する前に、編集中の内容を保存してください。
              </p>
              {issues.length ? (
                <>
                  <ul class="console-issues">
                    {issues.map((issue) => (
                      <li>
                        <p class="console-issue-field">{fieldLabel(issue.field)}</p>
                        <p>{issue.label}</p>
                        <p class="console-diff">
                          {issue.after === undefined ? (
                            <q>{issue.before}</q>
                          ) : (
                            <>
                              <del>{issue.before}</del>
                              <ins>{issue.after}</ins>
                            </>
                          )}
                        </p>
                        {issue.after !== undefined && (
                          <form method="post" action={`/works/${work.id}/console/fix`}>
                            <input type="hidden" name="revision" value={work.revision} />
                            <input type="hidden" name="field" value={issue.field} />
                            <input type="hidden" name="rule" value={issue.rule} />
                            <button class="btn btn-outline btn-sm" data-fix>
                              この修正を適用
                            </button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                  {issues.some((i) => i.after !== undefined) && (
                    <form method="post" action={`/works/${work.id}/console/fix`}>
                      <input type="hidden" name="revision" value={work.revision} />
                      <input type="hidden" name="rule" value="all" />
                      <button class="btn btn-primary btn-sm full" data-fix>
                        自動で直せるものをすべて適用
                      </button>
                    </form>
                  )}
                </>
              ) : (
                <p class="quiet">気になる表記は見つかりませんでした。</p>
              )}
            </section>
            <section class="card console-card">
              <h2>ほかの作品もまとめて直す</h2>
              <p class="quiet">同じ言い回しや名称を、すべての下書きで置き換えられます。</p>
              <a class="btn btn-outline btn-sm" href="/works/text">
                一括置換を開く
              </a>
            </section>
            <p class="quiet">
              保存しても公開中のページは変わりません。公開は確認画面から行います。
            </p>
          </aside>
        </div>
      </div>
      <script src="/console.js" defer />
    </Layout>
  );
}

export function BulkTextPage({
  user,
  works,
  find = '',
  replacement = '',
  result,
}: {
  user: User;
  works: Work[];
  find?: string;
  replacement?: string;
  result?: { updated: number; conflicts: number };
}) {
  const hits = works
    .map((w) => ({ work: w, matches: findMatches(w.data, find, replacement) }))
    .filter((h) => h.matches.length);
  return (
    <Layout title="表記の一括置換" user={user} active="works">
      <PageHeading
        title="表記をまとめて直す"
        description="すべての作品の下書きから言葉を探して置き換えます。公開中のページは変わりません。"
      />
      {result && (
        <p class={`alert ${result.conflicts ? 'alert-warning' : 'alert-success'}`} role="status">
          {result.updated}件の作品を更新しました。
          {result.conflicts
            ? `${result.conflicts}件は別の場所で更新されていたため変更していません。もう一度検索してください。`
            : ''}
        </p>
      )}
      <form method="get" class="card console-card bulk-search">
        <div class="field-pair">
          <label class="field">
            <span>探す言葉</span>
            <input class="input" name="find" value={find} required maxLength={100} />
          </label>
          <label class="field">
            <span>置き換える言葉</span>
            <input class="input" name="replace" value={replacement} maxLength={100} />
          </label>
        </div>
        <button class="btn btn-outline">変更を確認</button>
      </form>
      {find &&
        (hits.length ? (
          <form method="post" action="/works/text" class="bulk-results">
            <input type="hidden" name="find" value={find} />
            <input type="hidden" name="replace" value={replacement} />
            {hits.map(({ work, matches }) => (
              <section class="card console-card">
                <label class="bulk-work">
                  <input type="checkbox" class="checkbox" name="work" value={work.id} checked />
                  <input type="hidden" name={`revision_${work.id}`} value={work.revision} />
                  <strong>{work.data.title}</strong>
                  <span class="badge badge-ghost">
                    {matches.reduce((n, m) => n + m.count, 0)}か所
                  </span>
                </label>
                <ul class="console-issues">
                  {matches.map((m) => (
                    <li>
                      <p class="console-issue-field">{fieldLabel(m.field)}</p>
                      <p class="console-diff">
                        <del>{m.before}</del>
                        <ins>{m.after}</ins>
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <button class="btn btn-primary">選んだ作品に適用</button>
          </form>
        ) : (
          <p class="quiet">「{find}」を含む下書きはありません。</p>
        ))}
    </Layout>
  );
}
