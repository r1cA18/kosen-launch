import type { Child } from 'hono/jsx';
import { DomainError, type User, type Published, type Work } from './store';
import { kindLabels } from './schema';
import { Layout, Field, Avatar } from './ui';
import type { Join, Post, TimelineItem, TimelineStore } from './timeline';

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const workHref = (w: Published) => `/u/${w.handle}/works/${w.work_id}`;
const jst = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', ...options });
/** Relative time in the style of X: minutes, hours, then the calendar date. */
export function ago(iso: string, now = Date.now()) {
  const diff = Math.max(0, now - Date.parse(iso)) / 1000;
  if (diff < 60) return 'たった今';
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}日前`;
  const sameYear =
    jst(iso, { year: 'numeric' }) === jst(new Date(now).toISOString(), { year: 'numeric' });
  return jst(iso, sameYear ? { month: 'long', day: 'numeric' } : { dateStyle: 'long' });
}
export const fullTime = (iso: string) =>
  jst(iso, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export function Time({ at, href }: { at: string; href?: string }) {
  const time = (
    <time datetime={at} title={fullTime(at)}>
      {ago(at)}
    </time>
  );
  return href ? (
    <a class="x-time" href={href}>
      {time}
    </a>
  ) : (
    <span class="x-time">{time}</span>
  );
}
const paths = {
  reply:
    'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5Z',
  like: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  join: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0M17 8v6M14 11h6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  send: 'M4 12 20 4l-6 16-3-7Z',
  check: 'M5 12.5 10 17l9-10',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4Zm4 3a2 2 0 0 0 4 0',
  back: 'M15 5l-7 7 7 7',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  calendar: 'M5 6h14v14H5ZM5 10h14M9 3v4M15 3v4',
};
export type IconName = keyof typeof paths;
export function Icon({ name }: { name: IconName }) {
  return (
    <svg class={`x-icon x-icon-${name}`} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={paths[name]}
        fill="none"
        stroke="currentColor"
        stroke-width={name === 'more' ? 3 : 1.7}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
const joinLabels = {
  pending: '返事待ち',
  accepted: '受け入れ済み',
  declined: '見送り',
  cancelled: '取り消し',
};
export type TimelineView = {
  filter: 'all' | 'recruit';
  role?: string;
  compose: 'progress' | 'recruit';
};
const query = (v: Partial<TimelineView>) => {
  const q = new URLSearchParams();
  if (v.filter === 'recruit') q.set('filter', 'recruit');
  if (v.role) q.set('role', v.role);
  if (v.compose === 'recruit') q.set('compose', 'recruit');
  const s = q.toString();
  return s ? `/home?${s}` : '/home';
};

export function EmbeddedWork({ work, compact = false }: { work: Published; compact?: boolean }) {
  const image = work.data.asset_ids[0];
  return (
    <a class={`tl-embed x-embed ${compact ? 'x-embed-compact' : ''}`} href={workHref(work)}>
      {image && <img src={`/assets/${image}`} alt="" loading="lazy" />}
      <div>
        <span class="x-embed-meta">
          {work.display_name} · {kindLabels[work.data.kind]}
          {work.data.year ? ` · ${work.data.year}` : ''}
        </span>
        <strong>{work.data.title}</strong>
        <p>{work.data.summary}</p>
      </div>
    </a>
  );
}
function Head({
  name,
  handle,
  at,
  href,
  badge,
  children,
}: {
  name: string;
  handle: string;
  at: string;
  href?: string;
  badge?: string;
  children?: Child;
}) {
  return (
    <header class="x-post-head">
      <a class="x-name" href={`/u/${handle}`}>
        {name}
      </a>
      <span class="x-handle">@{handle}</span>
      <span class="x-sep" aria-hidden="true">
        ·
      </span>
      <Time at={at} href={href} />
      {badge && <span class="x-kind">{badge}</span>}
      {children}
    </header>
  );
}
function Moderation({ user, post, back }: { user?: User; post: Post; back: string }) {
  if (!user) return null;
  return (
    <details class="x-more">
      <summary aria-label="その他の操作">
        <Icon name="more" />
      </summary>
      <div class="x-more-panel">
        {user.id === post.author_id ? (
          <form method="post" action={`/timeline/${post.id}/delete`}>
            <input type="hidden" name="back" value={back} />
            <button class="x-menu-item x-danger">削除</button>
          </form>
        ) : (
          <>
            <form class="social-form" method="post" action={`/timeline/${post.id}/report`}>
              <input type="hidden" name="back" value={back} />
              <Field label="通報する理由" name="reason" required maxLength={1000} />
              <button class="btn btn-sm btn-primary">通報して非表示</button>
            </form>
            <form method="post" action={`/social/blocks/${post.author_id}`}>
              <button class="x-menu-item x-danger">@{post.handle}さんをブロック</button>
            </form>
          </>
        )}
      </div>
    </details>
  );
}
function Recruit({ post }: { post: Post }) {
  const closed = !!post.data.deadline && post.data.deadline < today();
  return (
    <section class="x-recruit" aria-label="仲間募集">
      <span class="x-recruit-label">
        <Icon name="join" />
        仲間募集
      </span>
      <h3>{post.data.title}</h3>
      <div class="x-chips">
        {post.data.roles.map((r) => (
          <a class="x-chip" href={`/home?role=${encodeURIComponent(r)}`}>
            {r}
          </a>
        ))}
      </div>
      <div class="x-recruit-foot">
        <span class="x-recruit-meta">
          <Icon name="calendar" />
          {post.data.deadline
            ? `締切 ${post.data.deadline}${closed ? '（締切済み）' : ''}`
            : '締切の指定なし'}
        </span>
        {post.data.url && (
          <a
            class="x-recruit-meta x-link"
            href={post.data.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="link" />
            募集の情報
          </a>
        )}
      </div>
    </section>
  );
}
function Actions({ post, user, back }: { post: Post; user?: User; back: string }) {
  const closed = !!post.data.deadline && post.data.deadline < today();
  return (
    <footer class="x-actions">
      <a
        class="x-action x-action-reply"
        href={user ? `/timeline/${post.id}#reply` : '/login'}
        aria-label={`返信 ${post.replies}件`}
      >
        <Icon name="reply" />
        <span>{post.replies}</span>
      </a>
      {user ? (
        <form method="post" action={`/timeline/${post.id}/like`}>
          <input type="hidden" name="back" value={back} />
          <button
            class="x-action x-action-like reaction"
            aria-pressed={post.liked}
            aria-label={post.liked ? '気になるを取り消す' : '気になる'}
          >
            <Icon name="like" />
            <span>{post.likes}</span>
            <em>{post.liked ? '気になるに追加済み' : '気になる'}</em>
          </button>
        </form>
      ) : (
        <a class="x-action x-action-like" href="/login" aria-label="気になる">
          <Icon name="like" />
          <span>{post.likes}</span>
          <em>気になる</em>
        </a>
      )}
      {post.kind === 'recruit' && !closed && user?.id !== post.author_id && (
        <a class="x-action x-action-join" href={user ? `/timeline/${post.id}#join` : '/login'}>
          <Icon name="join" />
          <em>参加したい</em>
        </a>
      )}
    </footer>
  );
}
export function PostCard({
  post,
  user,
  back,
  detail = false,
}: {
  post: Post;
  user?: User;
  back: string;
  detail?: boolean;
}) {
  const badge =
    post.kind === 'recruit' ? '仲間募集' : post.kind === 'progress' ? '進捗' : undefined;
  if (detail)
    return (
      <article class="x-post x-post-detail tl-item" id={`p-${post.id}`}>
        <div class="x-detail-author">
          <a href={`/u/${post.handle}`} aria-hidden="true" tabindex={-1}>
            <Avatar name={post.display_name} asset={post.avatar} />
          </a>
          <div>
            <a class="x-name" href={`/u/${post.handle}`}>
              {post.display_name}
            </a>
            <span class="x-handle">@{post.handle}</span>
          </div>
          {badge && <span class="x-kind">{badge}</span>}
          <Moderation user={user} post={post} back="/home" />
        </div>
        <p class="x-body x-body-lg preserve-lines">{post.body}</p>
        {post.kind === 'recruit' && <Recruit post={post} />}
        {post.work && <EmbeddedWork work={post.work} />}
        <p class="x-detail-time">
          <time datetime={post.created_at}>{fullTime(post.created_at)}</time>
        </p>
        <p class="x-stats">
          <span>
            <strong>{post.replies}</strong> 件の返信
          </span>
          <span>
            <strong>{post.likes}</strong> 件の気になる
          </span>
        </p>
        <Actions post={post} user={user} back={back} />
      </article>
    );
  return (
    <article class="x-post tl-item" id={`p-${post.id}`}>
      <a class="x-post-avatar" href={`/u/${post.handle}`} tabindex={-1} aria-hidden="true">
        <Avatar name={post.display_name} asset={post.avatar} />
      </a>
      <div class="x-post-main">
        <Head
          name={post.display_name}
          handle={post.handle}
          at={post.created_at}
          href={post.kind === 'reply' ? undefined : `/timeline/${post.id}`}
          badge={badge}
        >
          <Moderation user={user} post={post} back={back} />
        </Head>
        <p class="x-body preserve-lines">{post.body}</p>
        {post.kind === 'recruit' && <Recruit post={post} />}
        {post.work && <EmbeddedWork work={post.work} />}
        {post.kind !== 'reply' && <Actions post={post} user={user} back={back} />}
      </div>
    </article>
  );
}
export function ShareEvent({
  work,
  user,
  avatar,
  liked,
  likes,
}: {
  work: Published;
  user?: User;
  avatar: string | null;
  liked: boolean;
  likes: number;
}) {
  return (
    <article class="x-post tl-item">
      <a class="x-post-avatar" href={`/u/${work.handle}`} tabindex={-1} aria-hidden="true">
        <Avatar name={work.display_name} asset={avatar} />
      </a>
      <div class="x-post-main">
        <Head
          name={work.display_name}
          handle={work.handle}
          at={work.published_at}
          badge="作品の共有"
        />
        <p class="x-body">作品を共有しました。</p>
        <EmbeddedWork work={work} />
        <footer class="x-actions">
          <a class="x-action x-action-reply" href={`${workHref(work)}#conversation`}>
            <Icon name="reply" />
            <em>質問・誘い</em>
          </a>
          {user ? (
            <form method="post" action={`/works/${work.work_id}/react`} class="tl-react">
              <button
                class="x-action x-action-like reaction"
                aria-pressed={liked}
                aria-label={liked ? '気になるを取り消す' : '気になる'}
              >
                <Icon name="like" />
                <span>{likes}</span>
                <em>{liked ? '気になるに追加済み' : '気になる'}</em>
              </button>
            </form>
          ) : (
            <a class="x-action x-action-like" href="/login" aria-label="気になる">
              <Icon name="like" />
              <span>{likes}</span>
            </a>
          )}
        </footer>
      </div>
    </article>
  );
}
/** Renders a list of timeline items for the home feed and the profile Posts tab. */
export function FeedList({
  items,
  user,
  back,
  timeline,
}: {
  items: TimelineItem[];
  user?: User;
  back: string;
  timeline: TimelineStore;
}) {
  return (
    <div class="x-list tl-list">
      {items.map((item) =>
        item.type === 'post' ? (
          <PostCard post={item.post} user={user} back={back} />
        ) : (
          <ShareEvent
            work={item.work}
            user={user}
            avatar={timeline.store.avatarByHandle(item.work.handle)}
            liked={!!user && timeline.store.reacted(user.id, item.work.work_id)}
            likes={timeline.store.reactionCount(item.work.work_id)}
          />
        ),
      )}
    </div>
  );
}
function Composer({
  user,
  avatar,
  view,
  published,
}: {
  user: User;
  avatar: string | null;
  view: TimelineView;
  published: Work[];
}) {
  return (
    <section class="card x-composer tl-composer" aria-label="投稿">
      <Avatar name={user.display_name} asset={avatar} />
      <div class="x-composer-main">
        <nav class="x-compose-kind" aria-label="投稿の種類">
          <a
            href={query({ ...view, compose: 'progress' })}
            aria-current={view.compose === 'progress' ? 'page' : undefined}
          >
            進捗
          </a>
          <a
            href={query({ ...view, compose: 'recruit' })}
            aria-current={view.compose === 'recruit' ? 'page' : undefined}
          >
            仲間募集
          </a>
        </nav>
        {view.compose === 'recruit' ? (
          <form method="post" action="/timeline/posts" class="x-compose-form">
            <input type="hidden" name="kind" value="recruit" />
            <input
              class="x-compose-title"
              name="title"
              required
              maxLength={100}
              placeholder="活動名"
              aria-label="活動名"
            />
            <textarea
              class="x-compose-text"
              name="body"
              rows={3}
              maxLength={1000}
              required
              aria-label="募集の内容"
              placeholder="どんな活動で、誰と何をしたいかを書いてください。"
            />
            <Field
              label="求める役割（読点か改行で区切り）"
              name="roles"
              required
              maxLength={300}
              placeholder="UI設計、回路、発表"
            />
            <div class="field-pair">
              <Field label="募集のURL（任意）" name="url" type="url" maxLength={1500} />
              <Field label="応募締切（任意）" name="deadline" type="date" />
            </div>
            <div class="x-compose-bar">
              <span class="x-compose-hint">求める役割は8個まで指定できます。</span>
              <button class="btn btn-primary btn-sm">募集する</button>
            </div>
          </form>
        ) : (
          <form method="post" action="/timeline/posts" class="x-compose-form">
            <input type="hidden" name="kind" value="progress" />
            <textarea
              class="x-compose-text"
              name="body"
              rows={3}
              maxLength={280}
              required
              aria-label="制作の進み具合"
              placeholder="今日できたことや詰まっていることを書いてください。"
            />
            <div class="x-compose-bar">
              {published.length ? (
                <label class="x-compose-attach">
                  <span>作品を添付</span>
                  <select class="select select-sm" name="work_id">
                    <option value="">添付しない</option>
                    {published.map((w) => (
                      <option value={w.id}>{w.data.title}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <span class="x-compose-hint">280字まで投稿できます。</span>
              )}
              <button class="btn btn-primary btn-sm">投稿する</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
export function Timeline({
  user,
  timeline,
  works,
  view,
  unread,
}: {
  user: User;
  timeline: TimelineStore;
  works: Work[];
  view: TimelineView;
  unread: number;
}) {
  const items = timeline.feed(user.id, view.filter, view.role),
    roles = timeline.roles(user.id),
    back = query({ filter: view.filter, role: view.role }),
    published = works.filter((w) => w.published_revision);
  return (
    <section class="x-feed" aria-label="Timeline">
      <nav class="x-tabs" aria-label="絞り込み">
        <a href="/home" aria-current={view.filter === 'all' && !view.role ? 'page' : undefined}>
          すべて
        </a>
        <a
          href="/home?filter=recruit"
          aria-current={view.filter === 'recruit' && !view.role ? 'page' : undefined}
        >
          仲間募集
        </a>
        {roles.map((r) => (
          <a
            href={`/home?role=${encodeURIComponent(r)}`}
            aria-current={view.role === r ? 'page' : undefined}
          >
            {r}
          </a>
        ))}
      </nav>
      <Composer
        user={user}
        avatar={timeline.store.avatarOf(user.id)}
        view={view}
        published={published}
      />
      {!!unread && (
        <a class="x-unread" href="/connections?tab=notifications">
          <Icon name="bell" />
          新しい通知が{unread}件あります
        </a>
      )}
      {items.length ? (
        <FeedList items={items} user={user} back={back} timeline={timeline} />
      ) : (
        <div class="x-list x-empty">
          <h3>投稿はありません</h3>
          <p>進捗や仲間募集を投稿すると表示されます。</p>
        </div>
      )}
    </section>
  );
}
export function ContactPanel({
  action,
  mine,
  other,
  back,
}: {
  action: string;
  mine: string;
  other: string;
  back?: string;
}) {
  return (
    <div class="contact-panel x-contact">
      <h4>連絡先の共有</h4>
      <p>相手だけに連絡先を共有できます。空欄で保存すると共有を取り消せます。</p>
      {other && (
        <p>
          <a class="x-link" href={other} target="_blank" rel="noopener noreferrer">
            相手が共有した連絡先を開く
          </a>
        </p>
      )}
      <form method="post" action={action} class="x-inline-form">
        {back && <input type="hidden" name="back" value={back} />}
        <input
          class="input input-sm"
          name="contact"
          type="url"
          value={mine}
          maxLength={1500}
          placeholder="https://"
          aria-label="自分の連絡先URL"
        />
        <button class="btn btn-sm btn-primary">保存</button>
      </form>
    </div>
  );
}
export function JoinItem({
  join,
  user,
  back,
  title,
}: {
  join: Join;
  user: User;
  back?: string;
  title?: Child;
}) {
  const mine = join.applicant_id === user.id;
  return (
    <article class="x-card x-join">
      <header class="x-card-head">
        <Avatar name={join.applicant_name} asset={join.applicant_avatar} size="sm" />
        <div>
          <strong>
            <a href={`/u/${join.applicant_handle}`}>{join.applicant_name}</a>さんの参加希望
          </strong>
          {title}
        </div>
        <span class={`x-state x-state-${join.state}`}>{joinLabels[join.state]}</span>
      </header>
      <p class="x-card-role">希望する役割：{join.role}</p>
      <p class="preserve-lines">{join.message}</p>
      {join.work && <EmbeddedWork work={join.work} compact />}
      {join.state === 'pending' && (
        <div class="x-card-actions">
          {(mine ? ['cancelled'] : ['accepted', 'declined']).map((state) => (
            <form method="post" action={`/timeline/joins/${join.id}/state`}>
              <input type="hidden" name="state" value={state} />
              {back && <input type="hidden" name="back" value={back} />}
              <button class={state === 'accepted' ? 'btn btn-sm btn-primary' : 'btn btn-sm x-btn'}>
                {state === 'accepted'
                  ? '受け入れる'
                  : state === 'declined'
                    ? '今回は見送る'
                    : '取り消す'}
              </button>
            </form>
          ))}
        </div>
      )}
      {join.state === 'accepted' && (
        <ContactPanel
          action={`/timeline/joins/${join.id}/contact`}
          mine={mine ? join.applicant_contact : join.owner_contact}
          other={mine ? join.owner_contact : join.applicant_contact}
          back={back}
        />
      )}
    </article>
  );
}
export function TimelinePostPage({
  user,
  timeline,
  id,
  works,
  notice,
}: {
  user: User;
  timeline: TimelineStore;
  id: string;
  works: Work[];
  notice?: string;
}) {
  const post = timeline.post(id, user.id),
    replies = timeline.replies(id, user.id),
    joins = timeline.joins(id, user.id),
    published = works.filter((w) => w.published_revision),
    closed = !!post.data.deadline && post.data.deadline < today(),
    back = `/timeline/${id}`;
  if (post.kind === 'reply')
    throw new DomainError(404, '投稿が見つかりません。ホームを確認してください。');
  return (
    <Layout title={post.kind === 'recruit' ? post.data.title : '投稿'} user={user}>
      <div class="x-column">
        <header class="x-bar">
          <a class="x-back" href="/home" aria-label="ホームへ戻る">
            <Icon name="back" />
          </a>
          <h1>Post</h1>
        </header>
        {notice && (
          <p role="status" class="alert">
            {notice}
          </p>
        )}
        <div class="x-thread">
          <PostCard post={post} user={user} back={back} detail />
          <form
            id="reply"
            method="post"
            action={`/timeline/${id}/replies`}
            class="x-reply-composer"
          >
            <Avatar name={user.display_name} asset={timeline.store.avatarOf(user.id)} />
            <textarea
              class="x-compose-text"
              name="body"
              rows={2}
              maxLength={500}
              required
              aria-label="返信"
              placeholder={`@${post.handle}さんに返信`}
            />
            <button class="btn btn-primary btn-sm">返信</button>
          </form>
          <section id="replies" aria-label="返信" class="x-replies">
            {replies.map((r) => (
              <PostCard post={r} user={user} back={back} />
            ))}
            {!replies.length && <p class="x-quiet-row">まだ返信はありません。</p>}
          </section>
        </div>
        {post.kind === 'recruit' && (
          <section id="joins" class="x-joins">
            <h2>{user.id === post.author_id ? '届いた参加希望' : '自分の参加希望'}</h2>
            <p class="quiet">
              受け入れても応募や参加の確定にはなりません。連絡先は双方が選んだ相手にだけ共有されます。
            </p>
            <div class="social-stack">
              {joins.map((j) => (
                <JoinItem join={j} user={user} />
              ))}
              {!joins.length && <p class="quiet">参加希望はまだありません。</p>}
            </div>
            {user.id !== post.author_id &&
              !closed &&
              !joins.some((j) => j.state === 'pending' || j.state === 'accepted') && (
                <form
                  id="join"
                  method="post"
                  action={`/timeline/${id}/joins`}
                  class="card social-form x-join-form"
                >
                  <h3>参加したい</h3>
                  <Field
                    label="自分の役割"
                    name="role"
                    required
                    maxLength={100}
                    value={post.data.roles[0]}
                  />
                  {!!published.length && (
                    <label class="field">
                      <span>添える作品（任意）</span>
                      <select class="select" name="work_id">
                        <option value="">添えない</option>
                        {published.map((w) => (
                          <option value={w.id}>{w.data.title}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label class="field">
                    <span>メッセージ</span>
                    <textarea class="textarea" name="message" rows={3} maxLength={500} required />
                  </label>
                  <button class="btn btn-primary">参加希望を送る</button>
                </form>
              )}
            {closed && user.id !== post.author_id && (
              <p class="quiet">この募集は締切を過ぎています。</p>
            )}
          </section>
        )}
      </div>
    </Layout>
  );
}
