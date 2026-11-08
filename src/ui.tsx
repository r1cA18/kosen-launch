import type { Child } from 'hono/jsx';
import type { User, Work, Published, Proposal, Store } from './store';
import { kindLabels, statusLabels, type WorkData } from './schema';

type DisplayWork = Omit<WorkData, 'sources'>;
const linkTo = (work: Published) => `/u/${work.handle}/works/${work.work_id}`;
export function Layout({
  title,
  children,
  user,
  active = 'home',
  portfolio = false,
  publicViewer,
}: {
  title: string;
  children: Child;
  user?: User;
  active?: string;
  portfolio?: boolean;
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
        {user ? (
          <div class="app-shell">
            <aside class="sidebar">
              <a class="brand" href="/home">
                <span class="brand-mark">K</span>
                <span>Kosen Launch</span>
              </a>
              <p class="sidebar-caption">制作の、その先へ。</p>
              <nav aria-label="メインナビゲーション">
                <ul class="menu sidebar-menu">
                  {[
                    ['home', '/home', 'ホーム'],
                    ['works', '/works', '作品'],
                    ['opportunities', '/opportunities', '機会'],
                    ['connections', '/connections', '交流'],
                    ['connect', '/settings/agents', 'エージェント接続'],
                  ].map(([key, href, label]) => (
                    <li>
                      <a href={href} aria-current={active === key ? 'page' : undefined}>
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
              <a class="portfolio-link" href={`/u/${user.handle}`}>
                自分の公開ページを見る
              </a>
              <div class="sidebar-user">
                <span class="profile-avatar">{user.display_name.slice(0, 1)}</span>
                <div>
                  <strong>{user.display_name}</strong>
                  <span>@{user.handle}</span>
                </div>
                <form method="post" action="/logout">
                  <button class="btn btn-ghost btn-sm" type="submit">
                    ログアウト
                  </button>
                </form>
              </div>
            </aside>
            <main id="main" class="workspace">
              {children}
            </main>
          </div>
        ) : (
          <>
            <header class="public-header">
              <a class="brand" href="/">
                <span class="brand-mark">K</span>Kosen Launch
              </a>
              <a href={publicViewer ? '/home' : '/login'}>
                {publicViewer ? 'ホームへ戻る' : 'ログイン'}
              </a>
            </header>
            <main id="main">{children}</main>
          </>
        )}
      </body>
    </html>
  );
}
export function AuthPage({ register = false, error }: { register?: boolean; error?: string }) {
  return (
    <Layout title={register ? 'はじめる' : 'ログイン'}>
      <div class="auth-layout">
        <section class="auth-story">
          <p class="plain-label">高専での制作を、次の活動へ</p>
          <h1>
            つくったものから、
            <br />
            外につながる。
          </h1>
          <p class="lead">
            授業の制作も、夢中になった個人開発も。
            <br />
            あなたの経験が伝わるページを、一緒に整えましょう。
          </p>
          <div class="journey">
            <div>
              <span>1</span>
              <p>
                エージェントに
                <br />
                制作フォルダを渡す
              </p>
            </div>
            <div>
              <span>2</span>
              <p>
                下書きを確認して
                <br />
                自分のページへ
              </p>
            </div>
            <div>
              <span>3</span>
              <p>
                作品を見せて
                <br />
                次の接点をつくる
              </p>
            </div>
          </div>
          <p class="quiet">企画・デザイン・発表の経験も、あなたの作品です。</p>
        </section>
        <section class="card auth-panel">
          <h2>{register ? 'アカウントを作成' : 'おかえりなさい'}</h2>
          <p>
            {register ? '制作を残す場所から、始めましょう。' : '作品の続きから、始めましょう。'}
          </p>
          {error && (
            <p class="alert alert-error" role="alert">
              {error}
            </p>
          )}
          <form method="post" action={register ? '/register' : '/login'}>
            {register && (
              <>
                <Field label="表示名" name="display_name" required maxLength={60} />
                <Field
                  label="公開ID"
                  name="handle"
                  required
                  pattern="[a-z][a-z0-9-]{2,29}"
                  maxLength={30}
                  help="小文字の英字で始まる3〜30文字。英数字とハイフンが使えます。"
                />
              </>
            )}
            <Field label="メールアドレス" name="email" type="email" required autoComplete="email" />
            <Field
              label="パスワード"
              name="password"
              type="password"
              required
              minLength={10}
              maxLength={128}
              autoComplete={register ? 'new-password' : 'current-password'}
              help={register ? '10文字以上で入力してください。' : undefined}
            />
            {register && (
              <details class="school-details">
                <summary>学校の情報を追加する（任意）</summary>
                <Field label="学校" name="school" maxLength={120} />
                <div class="field-pair">
                  <Field label="学科" name="department" maxLength={100} />
                  <Field label="学年" name="grade" maxLength={30} />
                </div>
                <p class="quiet">学校の情報は公開ページには表示されません。</p>
              </details>
            )}
            <button class="btn btn-primary full" type="submit">
              {register ? '登録して始める' : 'ログイン'}
            </button>
          </form>
          <p class="auth-switch">
            {register ? (
              <a href="/login">すでに登録している方はこちら</a>
            ) : (
              <a href="/register">アカウントを作成する</a>
            )}
          </p>
        </section>
      </div>
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
  return (
    <Layout title="ホーム" user={user}>
      <PageHeading
        title="制作の続きが、ここに。"
        description="制作の進み具合を見せて、仲間や次の活動につなげましょう。"
        action={
          <a class="btn btn-outline" href="/settings/agents">
            作品を追加する
          </a>
        }
      />
      <section class="continue-panel">
        <div>
          <span class="status-dot" />
          自分の続き<h2>{works.length ? '作品を、伝わるかたちに。' : '最初の作品を、ここへ。'}</h2>
          <p>
            {works.length
              ? '下書きを確認して、あなたが担当したことや工夫を伝えましょう。'
              : '普段のエージェントと接続すると、制作フォルダから作品の下書きを届けられます。'}
          </p>
        </div>
        <a
          class="btn btn-primary"
          href={works.length ? `/works/${works[0].id}` : '/settings/agents'}
        >
          {works.length ? '最近の下書きを開く' : 'エージェントを接続する'}
        </a>
      </section>
      {children}
    </Layout>
  );
}
export function WorksPage({ user, works }: { user: User; works: Work[] }) {
  return (
    <Layout title="作品" user={user} active="works">
      <PageHeading
        title="自分の作品"
        description="小さな試作も、授業での工夫も。あなたの経験として残せます。"
        action={
          <div class="actions">
            {works.length > 0 && (
              <a class="btn btn-outline" href="/works/text">
                表記をまとめて直す
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
        <Empty
          title="最初の作品を追加しましょう"
          href="/settings/agents"
          label="エージェントを接続する"
        >
          制作したもののフォルダを、普段使っているエージェントへ渡してください。
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
        title="作品を整える"
        description={`編集版 ${work.revision} / ${work.published_revision ? '公開版 ' + work.published_revision : 'まだ公開されていません'}`}
        action={
          <div class="actions">
            <a class="btn btn-outline" href={`/works/${work.id}/console`}>
              見た目のまま編集
            </a>
            <a class="btn btn-primary" href={`/works/${work.id}/review`}>
              公開前に確認する
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
    <Layout title="公開前の確認" user={user} active="works">
      <PageHeading
        title="公開前の確認"
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
    <Layout title="エージェント接続" user={user} active="connect">
      <PageHeading
        title="エージェント接続"
        description="制作フォルダを読み取るエージェントと、あなたのポートフォリオをつなぎます。"
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
              placeholder="普段使うエージェント"
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
          <h2>制作フォルダを渡す</h2>
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
              作品と取り組み <span class="work-count">{selected.length}</span>
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
