import type { Child } from 'hono/jsx';
import type { User, Work, Published, Proposal, Store } from './store';
import { kindLabels, statusLabels, type WorkData } from './schema';

type DisplayWork = Omit<WorkData, 'sources'>;
const linkTo = (work: Published) => `/u/${work.handle}/works/${work.work_id}`;
const navigation = [
  ['home', '/home', 'Home'],
  ['works', '/works', 'Works'],
  ['opportunities', '/opportunities', 'Opportunities'],
  ['connections', '/connections', 'Messages'],
  ['connect', '/settings/agents', 'Agent'],
] as const;
function LogoMark() {
  return (
    <svg class="logo-mark" viewBox="0 0 48 32" aria-hidden="true">
      <path d="M0 6 6 0v26l-6 6Z" fill="#8484ad" />
      <path d="M6 0h12v26H6Z" fill="#52b8bb" />
      <path d="M0 32 6 26h12l-6 6Z" fill="#34345f" />
      <path d="M22 0 42 26H22Z" fill="#e57f84" />
      <path d="M22 26h20l-6 6H16Z" fill="#e3b5b5" />
    </svg>
  );
}
function ArrowIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" />
    </svg>
  );
}
export function Layout({
  title,
  children,
  user,
  active = 'home',
  portfolio = false,
  landing = false,
  publicViewer,
}: {
  title: string;
  children: Child;
  user?: User;
  active?: string;
  portfolio?: boolean;
  landing?: boolean;
  publicViewer?: User;
}) {
  return (
    <html lang="ja" data-theme="kosen">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title} | Kosen Launch</title>
        <link rel="stylesheet" href="/fonts.css" />
        <link rel="stylesheet" href="/style.css" />
        <link rel="icon" href="/favicon.svg" />
        <script src="/app.js" defer />
      </head>
      <body data-surface={user ? 'dashboard' : portfolio ? 'portfolio' : 'auth'}>
        <a class="skip-link" href="#main">
          本文へ移動
        </a>
        <header class="site-header">
          <a class="site-logo" href={user ? '/home' : '/'} aria-label="Kosen Launch">
            <LogoMark />
          </a>
          {user ? (
            <details class="site-menu">
              <summary aria-label="メニュー">
                <span class="menu-lines" />
              </summary>
              <nav class="menu-panel" aria-label="メインナビゲーション">
                <ul>
                  {navigation.map(([key, href, label]) => (
                    <li>
                      <a href={href} aria-current={active === key ? 'page' : undefined}>
                        {label}
                        <ArrowIcon />
                      </a>
                    </li>
                  ))}
                </ul>
                <div class="menu-account">
                  <span class="profile-avatar">{user.display_name.slice(0, 1)}</span>
                  <div>
                    <strong>{user.display_name}</strong>
                    <a href={`/u/${user.handle}`}>@{user.handle}</a>
                  </div>
                  <form method="post" action="/logout">
                    <button class="ui-action ui-action-quiet" type="submit">
                      ログアウト
                    </button>
                  </form>
                </div>
              </nav>
            </details>
          ) : portfolio ? (
            <a class="ui-action ui-action-plain" href={publicViewer ? '/home' : '/login'}>
              {publicViewer ? 'Home' : 'ログイン'}
            </a>
          ) : null}
        </header>
        <main id="main" class={user ? 'ui-page' : landing ? 'ui-landing' : 'ui-public'}>
          {children}
        </main>
        <footer class="site-footer">© 2026 Kosen Launch</footer>
      </body>
    </html>
  );
}
export function LandingPage() {
  return (
    <Layout title="Kosen Launch" landing>
      <section class="hero landing-hero">
        <div class="hero-content text-center">
          <div class="landing-copy">
            <span class="landing-logo">
              <LogoMark />
            </span>
            <h1>Kosen Launch</h1>
            <p>
              高専の授業制作や個人開発を、担当範囲と根拠を付けた作品ページにまとめるWebサービスです。
            </p>
            <div class="landing-actions">
              <a class="btn btn-primary btn-lg" href="/register">
                アカウント作成
              </a>
              <a class="btn btn-lg glass-action" href="/login">
                ログイン
              </a>
            </div>
          </div>
        </div>
        <a class="scroll-cue" href="#how" aria-label="使い方へ移動">
          <svg viewBox="0 0 16 32" aria-hidden="true">
            <path d="M8 2v26M3 23l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </a>
      </section>
      <section class="landing-steps" id="how">
        <h2>How it works</h2>
        <ol>
          {[
            [
              'Draft',
              'Claude CodeなどのコーディングエージェントがSkillとMCPで制作フォルダを読み、作品の下書きを送ります。',
            ],
            ['Review', '担当範囲と根拠をWeb上で確認・編集してから公開します。'],
            ['Connect', '制作ログの投稿、仲間募集への参加、イベントの準備案作成ができます。'],
          ].map(([title, body], i) => (
            <li class="card glass-card">
              <span class="step-index">0{i + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </Layout>
  );
}
export function AuthPage({ register = false, error }: { register?: boolean; error?: string }) {
  return (
    <Layout title={register ? 'アカウント作成' : 'ログイン'}>
      <section class="auth-shell">
        <div class="card glass-card auth-card">
          <a class="auth-logo" href="/" aria-label="トップへ戻る">
            <LogoMark />
          </a>
          <h1>{register ? 'Sign up' : 'Log in'}</h1>
          <div role="tablist" class="tabs tabs-box auth-tabs">
            <a role="tab" href="/login" class={`tab ${register ? '' : 'tab-active'}`}>
              ログイン
            </a>
            <a role="tab" href="/register" class={`tab ${register ? 'tab-active' : ''}`}>
              アカウント作成
            </a>
          </div>
          {error && (
            <p class="alert alert-error" role="alert">
              {error}
            </p>
          )}
          <form method="post" action={register ? '/register' : '/login'} class="auth-form">
            {register && (
              <>
                <fieldset class="fieldset">
                  <legend class="fieldset-legend">表示名</legend>
                  <input
                    class="input validator w-full"
                    name="display_name"
                    required
                    maxLength={60}
                  />
                </fieldset>
                <fieldset class="fieldset">
                  <legend class="fieldset-legend">公開ID</legend>
                  <label class="input validator w-full">
                    <span class="label">/u/</span>
                    <input
                      name="handle"
                      required
                      pattern="[a-z][a-z0-9-]{2,29}"
                      maxLength={30}
                      autoComplete="username"
                    />
                  </label>
                  <p class="label">小文字の英字で始まる3〜30文字。英数字とハイフンが使えます。</p>
                </fieldset>
              </>
            )}
            <fieldset class="fieldset">
              <legend class="fieldset-legend">メールアドレス</legend>
              <input
                class="input validator w-full"
                name="email"
                type="email"
                required
                autoComplete="email"
              />
            </fieldset>
            <fieldset class="fieldset">
              <legend class="fieldset-legend">パスワード</legend>
              <input
                class="input validator w-full"
                name="password"
                type="password"
                required
                minLength={10}
                maxLength={128}
                autoComplete={register ? 'new-password' : 'current-password'}
              />
              {register && <p class="label">10文字以上で入力してください。</p>}
            </fieldset>
            {register && (
              <details class="school-details">
                <summary>学校の情報（任意）</summary>
                <fieldset class="fieldset">
                  <legend class="fieldset-legend">学校</legend>
                  <input class="input w-full" name="school" maxLength={120} />
                </fieldset>
                <div class="field-pair">
                  <fieldset class="fieldset">
                    <legend class="fieldset-legend">学科</legend>
                    <input class="input w-full" name="department" maxLength={100} />
                  </fieldset>
                  <fieldset class="fieldset">
                    <legend class="fieldset-legend">学年</legend>
                    <input class="input w-full" name="grade" maxLength={30} />
                  </fieldset>
                </div>
                <p class="label">学校の情報は公開ページに表示されません。</p>
              </details>
            )}
            <button class="btn btn-primary btn-block" type="submit">
              {register ? 'アカウント作成' : 'ログイン'}
            </button>
          </form>
        </div>
      </section>
    </Layout>
  );
}
export function Field({
  label,
  help,
  ...props
}: {
  label: string;
  help?: string;
  name: string;
  [key: string]: unknown;
}) {
  return (
    <label class="field">
      <span>{label}</span>
      <input class="input" {...props} />
      {help && <small>{help}</small>}
    </label>
  );
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: Child;
}) {
  return (
    <header class="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function Empty({
  title,
  children,
  href,
  label,
}: {
  title: string;
  children: Child;
  href: string;
  label: string;
}) {
  return (
    <section class="empty">
      <div class="empty-sheet" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      <a class="btn btn-primary" href={href}>
        {label}
      </a>
    </section>
  );
}
export function WorkCard({
  data,
  href,
  meta,
  image,
}: {
  data: DisplayWork;
  href: string;
  meta: string;
  image?: string;
}) {
  return (
    <a class="card work-card" href={href}>
      <div class={`card-visual ${image ? '' : 'without-image'}`}>
        {image ? (
          <img src={image} alt="" loading="lazy" />
        ) : (
          <span class="badge badge-ghost">{kindLabels[data.kind]}</span>
        )}
        <span class="card-year">{data.year ?? '制作年未確認'}</span>
      </div>
      <div class="card-body">
        <p class="card-meta">{meta}</p>
        <h3>{data.title}</h3>
        <p>{data.summary}</p>
        <div class="tags">
          {data.my_roles.slice(0, 3).map((t) => (
            <span class="badge badge-ghost">{t}</span>
          ))}
        </div>
      </div>
    </a>
  );
}
export function HomePage({
  user,
  works,
  children,
}: {
  user: User;
  works: Work[];
  children: Child;
}) {
  const drafts = works.filter((w) => !w.published_revision).length;
  return (
    <Layout title="Home" user={user}>
      <PageHeading
        title="Home"
        action={
          <a class="ui-action ui-action-plain" href="/settings/agents">
            作品を追加
          </a>
        }
      />
      <section class="status-strip">
        {works.length ? (
          <p>
            作品 <strong>{works.length}</strong> 件（下書き {drafts} 件・公開中{' '}
            {works.length - drafts} 件）
          </p>
        ) : (
          <p>
            作品はまだありません。エージェントを接続すると、制作フォルダから下書きを作成できます。
          </p>
        )}
        <a
          class="ui-action ui-action-primary"
          href={works.length ? `/works/${works[0].id}` : '/settings/agents'}
        >
          {works.length ? '最新の下書きを開く' : 'エージェントを接続'}
        </a>
      </section>
      {children}
    </Layout>
  );
}
export function WorksPage({ user, works }: { user: User; works: Work[] }) {
  return (
    <Layout title="Works" user={user} active="works">
      <PageHeading
        title="Works"
        action={
          <div class="actions">
            {works.length > 0 && (
              <a class="btn btn-outline" href="/works/text">
                表記の一括置換
              </a>
            )}
            <a class="btn btn-primary" href="/settings/agents">
              エージェントで追加
            </a>
          </div>
        }
      />
      {works.length ? (
        <div class="work-grid">
          {works.map((w) => (
            <WorkCard
              data={w.data}
              href={`/works/${w.id}`}
              meta={w.published_revision ? `公開中 / 編集版 ${w.revision}` : '下書き'}
              image={w.data.asset_ids[0] ? `/assets/${w.data.asset_ids[0]}` : undefined}
            />
          ))}
        </div>
      ) : (
        <Empty title="作品はまだありません" href="/settings/agents" label="エージェントを接続">
          エージェントを接続すると、制作フォルダから作品の下書きを作成できます。
        </Empty>
      )}
    </Layout>
  );
}
export function WorkDetail({
  data,
  store,
  userId,
}: {
  data: DisplayWork;
  store: Store;
  userId?: string;
}) {
  return (
    <article class="work-detail">
      <div class="tags">
        <span class="badge badge-ghost">{kindLabels[data.kind]}</span>
        <span class="badge badge-ghost">{statusLabels[data.status]}</span>
        <span class="badge badge-ghost">{data.year ?? '制作年未確認'}</span>
      </div>
      <h1>{data.title}</h1>
      <p class="work-summary">{data.summary}</p>
      {data.asset_ids.length > 0 && (
        <div class="gallery">
          {data.asset_ids.map((id) => {
            const image = store.asset(id, userId);
            return <img src={`/assets/${id}`} alt={image.alt} loading="lazy" />;
          })}
        </div>
      )}
      <section>
        <h2>自分が担当したこと</h2>
        <div class="tags">
          {data.my_roles.map((r) => (
            <span class="badge badge-ghost">{r}</span>
          ))}
        </div>
        <p>{data.my_contribution}</p>
      </section>
      {[
        ['チームで作ったもの', data.team_result],
        ['工夫したこと', data.ingenuity],
        ['結果と学んだこと', data.outcome],
        ['次にしてみたいこと', data.next_interest],
      ]
        .filter(([, v]) => v)
        .map(([label, value]) => (
          <section>
            <h2>{label}</h2>
            <p>{value}</p>
          </section>
        ))}
      {data.tags.length > 0 && (
        <div class="tags">
          {data.tags.map((t) => (
            <span class="badge badge-ghost">{t}</span>
          ))}
        </div>
      )}
    </article>
  );
}
export function WorkEditor({
  user,
  work,
  store,
  proposals,
  notice,
}: {
  user: User;
  work: Work;
  store: Store;
  proposals: Proposal[];
  notice?: string;
}) {
  const d = work.data;
  return (
    <Layout title={d.title} user={user} active="works">
      <PageHeading
        title="Edit"
        description={`編集版 ${work.revision} / ${work.published_revision ? '公開版 ' + work.published_revision : 'まだ公開されていません'}`}
        action={
          <div class="actions">
            <a class="btn btn-outline" href={`/works/${work.id}/console`}>
              プレビューで編集
            </a>
            <a class="btn btn-primary" href={`/works/${work.id}/review`}>
              公開前の確認
            </a>
          </div>
        }
      />
      {notice && (
        <p class="alert alert-success" role="status">
          {notice}
        </p>
      )}
      {proposals.map((p) => (
        <section class="proposal">
          <h2>エージェントから更新案が届いています</h2>
          <p>元の版：{p.base_revision}。採用すると下書きが更新されます。</p>
          <details>
            <summary>現在の内容と更新案を比較する</summary>
            <div class="comparison">
              <div>
                <h3>現在</h3>
                <WorkDetail data={d} store={store} userId={user.id} />
              </div>
              <div>
                <h3>更新案</h3>
                <WorkDetail data={p.data} store={store} userId={user.id} />
              </div>
            </div>
          </details>
          <div class="actions">
            <form method="post" action={`/proposals/${p.id}/accept`}>
              <button class="btn btn-primary">更新案を採用</button>
            </form>
            <form method="post" action={`/proposals/${p.id}/dismiss`}>
              <button class="btn btn-outline">見送る</button>
            </form>
          </div>
        </section>
      ))}
      <div class="editor-layout">
        <section class="card editor-fields">
          <h2>作品の内容</h2>
          <form method="post" action={`/works/${work.id}/save`}>
            <input type="hidden" name="revision" value={work.revision} />
            <Field label="作品名" name="title" value={d.title} required maxLength={120} />
            <label class="field">
              <span>どんな作品ですか</span>
              <textarea class="textarea" name="summary" required maxLength={700} rows={3}>
                {d.summary}
              </textarea>
            </label>
            <div class="field-pair">
              <label class="field">
                <span>制作の種類</span>
                <select class="select" name="kind">
                  {Object.entries(kindLabels).map(([value, label]) => (
                    <option value={value} selected={value === d.kind}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="制作年（不明なら空欄）"
                name="year"
                type="number"
                min={2000}
                max={2100}
                value={d.year ?? ''}
              />
            </div>
            <label class="field">
              <span>制作の状態</span>
              <select class="select" name="status">
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option value={value} selected={value === d.status}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="担当した役割（カンマ区切り）"
              name="my_roles"
              value={d.my_roles.join(', ')}
              required
            />
            <label class="field">
              <span>自分が担当したこと</span>
              <textarea class="textarea" name="my_contribution" required rows={4} maxLength={3000}>
                {d.my_contribution}
              </textarea>
            </label>
            {[
              ['team_result', 'チームで作ったもの', 2000],
              ['ingenuity', '工夫したこと', 3000],
              ['outcome', '結果と学んだこと', 2000],
              ['next_interest', '次にしてみたいこと', 1000],
            ].map(([name, label, max]) => (
              <label class="field">
                <span>{label}</span>
                <textarea class="textarea" name={String(name)} rows={3} maxLength={Number(max)}>
                  {d[name as keyof WorkData] as string}
                </textarea>
              </label>
            ))}
            <Field label="タグ（カンマ区切り）" name="tags" value={d.tags.join(', ')} />
            <button class="btn btn-primary full">下書きを保存</button>
          </form>
          <section class="attachment-form">
            <h3>画像を追加</h3>
            <form method="post" action={`/works/${work.id}/image`} encType="multipart/form-data">
              <input type="hidden" name="revision" value={work.revision} />
              <label class="field">
                <span>画像ファイル</span>
                <input
                  name="image"
                  type="file"
                  class="file-input"
                  accept="image/png,image/jpeg,image/webp"
                  required
                />
              </label>
              <Field label="画像の説明" name="alt" required maxLength={200} />
              <button class="btn btn-outline">画像を追加</button>
            </form>
          </section>
          {d.sources.length > 0 && (
            <details>
              <summary>根拠のメモ（非公開）</summary>
              {d.sources.map((s) => (
                <p>
                  <strong>{s.label}</strong>
                  <br />
                  {s.note}
                </p>
              ))}
            </details>
          )}
          <Assessment data={d} />
        </section>
        <section class="preview-column">
          <div class="preview-label">公開ページのプレビュー</div>
          <div class="preview-paper">
            <WorkDetail data={d} store={store} userId={user.id} />
          </div>
          <p class="quiet">下書きの保存では公開中のページは変更されません。</p>
        </section>
      </div>
    </Layout>
  );
}
export function ReviewPage({ user, work, store }: { user: User; work: Work; store: Store }) {
  return (
    <Layout title="Review" user={user} active="works">
      <PageHeading
        title="Review"
        description="本人の担当と結果に誤りがないか確認してください。"
        action={
          <a class="btn btn-outline" href={`/works/${work.id}`}>
            編集に戻る
          </a>
        }
      />
      <div class="review-layout">
        <div class="preview-paper">
          <WorkDetail data={work.data} store={store} userId={user.id} />
        </div>
        <aside class="card publish-panel">
          <h2>公開する内容</h2>
          <p>編集版 {work.revision}</p>
          <p>根拠のメモや学校の登録情報は公開されません。</p>
          <Assessment data={work.data} />
          <form method="post" action={`/works/${work.id}/publish`}>
            <input type="hidden" name="revision" value={work.revision} />
            <label class="check-field">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                name="reviewed"
                value="yes"
                required
              />
              担当と内容を確認しました
            </label>
            <label class="check-field">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                name="share_to_feed"
                value="yes"
              />
              ホームにも共有する
            </label>
            <button class="btn btn-primary full">この内容を公開</button>
          </form>
          {work.published_revision && (
            <>
              <a class="btn btn-outline full" href={`/u/${user.handle}/works/${work.id}`}>
                現在の公開版を見る
              </a>
              <form method="post" action={`/works/${work.id}/withdraw`}>
                <button class="btn btn-ghost btn-sm text-error">公開を停止</button>
              </form>
            </>
          )}
        </aside>
      </div>
    </Layout>
  );
}
export function ConnectPage({
  user,
  tokens,
  origin,
  issued,
}: {
  user: User;
  tokens: ReturnType<Store['tokens']>;
  origin: string;
  issued?: { token: string; expires: number };
}) {
  const config = JSON.stringify(
    {
      mcpServers: {
        'kosen-launch': {
          command: 'bun',
          args: ['/path/to/kosen-launch/src/mcp.ts'],
          env: { KOSEN_LAUNCH_URL: origin, KOSEN_LAUNCH_TOKEN: '発行したトークン' },
        },
      },
    },
    null,
    2,
  );
  return (
    <Layout title="Agent" user={user} active="connect">
      <PageHeading
        title="Agent"
        description="コーディングエージェントにSkillとMCPを設定し、制作フォルダから作品の下書きを作成します。"
      />
      <div class="connect-layout">
        <section class="card setup-step">
          <span class="step-number">1</span>
          <h2>連携トークンを作る</h2>
          <p>下書きの作成と更新案の送信に使います。公開はこのWeb画面で確認して行います。</p>
          <form method="post" action="/settings/agents/tokens">
            <Field
              label="接続名"
              name="label"
              placeholder="例：Claude Code"
              required
              maxLength={80}
            />
            <button class="btn btn-primary">トークンを発行</button>
          </form>
          {issued && (
            <div class="token-result">
              <p role="status">トークンを発行しました。この画面で一度だけ表示します。</p>
              <label class="field">
                <span>連携トークン</span>
                <input class="input" id="issued-token" value={issued.token} readonly />
              </label>
              <button class="btn btn-outline" type="button" data-copy="issued-token">
                コピー
              </button>
              <p class="quiet">有効期限：{new Date(issued.expires).toLocaleDateString('ja-JP')}</p>
            </div>
          )}
        </section>
        <section class="card setup-step">
          <span class="step-number">2</span>
          <h2>SkillとMCPを接続する</h2>
          <p>Skillを利用するエージェントのSkillディレクトリへ配置してください。</p>
          <a class="btn btn-outline" href="/downloads/kosen-portfolio-skill.md" download="SKILL.md">
            Skillをダウンロード
          </a>
          <details>
            <summary>MCPの接続設定を見る</summary>
            <p>パスをこのプロジェクトの場所へ置き換え、発行したトークンを設定してください。</p>
            <pre>
              <code>{config}</code>
            </pre>
          </details>
        </section>
        <section class="card setup-step">
          <span class="step-number">3</span>
          <h2>下書きを依頼する</h2>
          <blockquote>
            このフォルダからKosen
            Launchのポートフォリオ下書きを作って。自分の担当が不明なところは質問して。
          </blockquote>
          <p>エージェントから下書きが届くと、作品一覧で確認できます。</p>
          <a class="btn btn-outline" href="/works">
            作品一覧を見る
          </a>
        </section>
      </div>
      <section class="token-list">
        <h2>接続の管理</h2>
        {tokens.length ? (
          tokens.map((t) => (
            <div class="token-row">
              <div>
                <strong>{t.label}</strong>
                <p>
                  {t.revoked
                    ? '失効済み'
                    : t.expires < Date.now()
                      ? '期限切れ'
                      : `有効期限 ${new Date(t.expires).toLocaleDateString('ja-JP')}`}
                </p>
              </div>
              {!t.revoked && (
                <form method="post" action={`/settings/agents/tokens/${t.id}/revoke`}>
                  <button class="btn btn-outline">接続を解除</button>
                </form>
              )}
            </div>
          ))
        ) : (
          <p>接続はまだありません。</p>
        )}
      </section>
    </Layout>
  );
}
export function PublicPortfolio({
  profile,
  works,
  year,
  tag,
}: {
  profile: { display_name: string; handle: string };
  works: Published[];
  year?: string;
  tag?: string;
}) {
  const years = [...new Set(works.map((w) => w.data.year).filter((y) => y !== null))].sort(
    (a, b) => b - a,
  );
  const tags = [...new Set(works.flatMap((w) => w.data.tags))];
  const selected = works.filter(
    (w) => (!year || String(w.data.year) === year) && (!tag || w.data.tags.includes(tag)),
  );
  return (
    <Layout title={profile.display_name} portfolio>
      <div class="public-portfolio">
        <p class="portfolio-eyebrow">Portfolio</p>
        <header class="profile-heading">
          <span class="profile-avatar large">{profile.display_name.slice(0, 1)}</span>
          <div>
            <p>@{profile.handle}</p>
            <h1>{profile.display_name}</h1>
          </div>
        </header>
        <div class="section-heading">
          <div>
            <h2>Works</h2>
            <p class="quiet">
              <span class="work-count">{selected.length}</span> 件
            </p>
          </div>
          <form method="get" class="filters">
            <label>
              年
              <select class="select" name="year">
                <option value="">すべて</option>
                {years.map((y) => (
                  <option value={String(y)} selected={year === String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label>
              タグ
              <select class="select" name="tag">
                <option value="">すべて</option>
                {tags.map((t) => (
                  <option value={t} selected={tag === t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <button class="btn btn-outline">絞り込む</button>
          </form>
        </div>
        {selected.length ? (
          <div class="work-grid">
            {selected.map((w) => (
              <WorkCard
                data={w.data}
                href={linkTo(w)}
                meta={kindLabels[w.data.kind]}
                image={w.data.asset_ids[0] ? `/assets/${w.data.asset_ids[0]}` : undefined}
              />
            ))}
          </div>
        ) : (
          <div class="feed-empty">
            <p>
              {works.length ? '条件に合う作品がありません。' : '公開された作品はまだありません。'}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
export function PublicWorkPage({
  work,
  store,
  children,
  viewer,
}: {
  work: Published;
  store: Store;
  children?: Child;
  viewer?: User;
}) {
  return (
    <Layout title={work.data.title} portfolio publicViewer={viewer}>
      <div class="public-work">
        <a class="back-link" href={`/u/${work.handle}`}>
          {work.display_name}の作品一覧
        </a>
        <WorkDetail data={work.data} store={store} />
        {children}
        <footer class="work-footer">{work.display_name} / Kosen Launch</footer>
      </div>
    </Layout>
  );
}
function Assessment({ data }: { data: WorkData }) {
  const a = data.assessment;
  return (
    <aside class="assessment">
      <h3>担当の判断と確認事項（非公開）</h3>
      <p>
        {a
          ? {
              documented: '資料に担当の記載があります。',
              inferred: '担当は資料からの推定です。',
              unknown: '本人の担当を確定できていません。',
            }[a.basis]
          : '担当の判断記録がまだありません。根拠メモと本文を確認してください。'}
      </p>
      {a && (
        <>
          <p>{a.evidence}</p>
          {!!a.uncertainties.length && (
            <ul>
              {a.uncertainties.map((s) => (
                <li>{s}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}
export function ErrorPage({ message, user }: { message: string; user?: User }) {
  return (
    <Layout title="操作を確認してください" user={user}>
      <section class="error-page">
        <h1>操作を完了できませんでした</h1>
        <p role="alert">{message}</p>
        <a class="btn btn-primary" href={user ? '/works' : '/login'}>
          {user ? '作品一覧へ戻る' : 'ログインへ戻る'}
        </a>
      </section>
    </Layout>
  );
}
