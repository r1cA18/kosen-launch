import { DomainError, type User, type Published, type Work } from './store';
import { kindLabels } from './schema';
import { Layout, Field, PageHeading } from './ui';
import type { Join, Post, TimelineItem, TimelineStore } from './timeline';

const date = (iso: string) => iso.slice(0, 10);
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const workHref = (w: Published) => `/u/${w.handle}/works/${w.work_id}`;
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

function EmbeddedWork({ work }: { work: Published }) {
  const image = work.data.asset_ids[0];
  return (
    <a class="tl-embed" href={workHref(work)}>
      {image && <img src={`/assets/${image}`} alt="" loading="lazy" />}
      <div>
        <span class="tl-meta">
          {work.display_name} / {kindLabels[work.data.kind]}
        </span>
        <strong>{work.data.title}</strong>
        <p>{work.data.summary}</p>
      </div>
    </a>
  );
}
function Author({
  name,
  handle,
  at,
  badge,
}: {
  name: string;
  handle: string;
  at: string;
  badge?: string;
}) {
  return (
    <p class="tl-head">
      <span class="profile-avatar">{name.slice(0, 1)}</span>
      <a href={`/u/${handle}`}>{name}</a>
      <span class="tl-meta">
        @{handle} · {date(at)}
      </span>
      {badge && <span class="badge badge-outline">{badge}</span>}
    </p>
  );
}
function Moderation({ user, post, back }: { user: User; post: Post; back: string }) {
  return (
    <div class="tl-menu">
      {user.id === post.author_id ? (
        <form method="post" action={`/timeline/${post.id}/delete`}>
          <input type="hidden" name="back" value={back} />
          <button class="btn btn-ghost btn-sm">削除</button>
        </form>
      ) : (
        <details>
          <summary>通報・ブロック</summary>
          <form class="social-form" method="post" action={`/timeline/${post.id}/report`}>
            <input type="hidden" name="back" value={back} />
            <Field label="通報する理由" name="reason" required maxLength={1000} />
            <button class="btn btn-outline btn-sm">通報して自分の画面で非表示</button>
          </form>
          <form method="post" action={`/social/blocks/${post.author_id}`}>
            <button class="btn btn-ghost btn-sm">この利用者をブロック</button>
          </form>
        </details>
      )}
    </div>
  );
}
function Recruit({ post }: { post: Post }) {
  const closed = !!post.data.deadline && post.data.deadline < today();
  return (
    <>
      <h3>{post.data.title}</h3>
      <div class="tags">
        {post.data.roles.map((r) => (
          <a class="badge badge-ghost" href={`/home?role=${encodeURIComponent(r)}`}>
            {r}
          </a>
        ))}
      </div>
      <p class="tl-meta">
        {post.data.deadline
          ? `応募締切 ${post.data.deadline}${closed ? '（締切済み）' : ''}`
          : '締切の指定なし'}
      </p>
      {post.data.url && (
        <p>
          <a href={post.data.url} target="_blank" rel="noopener noreferrer">
            募集の情報を見る
          </a>
        </p>
      )}
    </>
  );
}
export function PostCard({
  post,
  user,
  back,
  detail = false,
}: {
  post: Post;
  user: User;
  back: string;
  detail?: boolean;
}) {
  const closed = !!post.data.deadline && post.data.deadline < today();
  return (
    <article class="tl-item" id={`p-${post.id}`}>
      <Author
        name={post.display_name}
        handle={post.handle}
        at={post.created_at}
        badge={post.kind === 'recruit' ? '仲間募集' : post.kind === 'progress' ? '進捗' : undefined}
      />
      {post.kind === 'recruit' && <Recruit post={post} />}
      <p class="preserve-lines">{post.body}</p>
      {post.work && <EmbeddedWork work={post.work} />}
      {post.kind !== 'reply' && (
        <div class="tl-actions">
          <form method="post" action={`/timeline/${post.id}/like`}>
            <input type="hidden" name="back" value={back} />
            <button class="btn btn-ghost btn-sm reaction" aria-pressed={post.liked}>
              {post.liked ? '気になるに追加済み' : '気になる'}
              <span>{post.likes}</span>
            </button>
          </form>
          {!detail && (
            <a class="btn btn-ghost btn-sm" href={`/timeline/${post.id}#replies`}>
              返信 {post.replies}
            </a>
          )}
          {post.kind === 'recruit' && user.id !== post.author_id && !closed && (
            <a class="btn btn-outline btn-sm" href={`/timeline/${post.id}#join`}>
              参加したい
            </a>
          )}
          {!detail && <Moderation user={user} post={post} back={back} />}
        </div>
      )}
    </article>
  );
}
function ShareEvent({ work }: { work: Published }) {
  return (
    <article class="tl-item">
      <p class="tl-head">
        <span class="profile-avatar">{work.display_name.slice(0, 1)}</span>
        <a href={`/u/${work.handle}`}>{work.display_name}</a>
        <span class="tl-meta">
          @{work.handle} · {date(work.published_at)}
        </span>
        <span class="badge badge-outline">作品の共有</span>
      </p>
      <p>作品を共有しました。</p>
      <EmbeddedWork work={work} />
      <div class="tl-actions">
        <a class="btn btn-ghost btn-sm" href={`${workHref(work)}#conversation`}>
          質問・誘い
        </a>
      </div>
    </article>
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
    <section class="timeline" aria-label="Timeline">
      <div class="section-heading">
        <h2>Timeline</h2>
        <a href="/connections">{unread ? `新しいお知らせ ${unread}件` : '質問と誘いを確認する'}</a>
      </div>
      <section class="tl-composer">
        <nav class="tl-tabs" aria-label="投稿の種類">
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
          <form method="post" action="/timeline/posts" class="social-form">
            <input type="hidden" name="kind" value="recruit" />
            <Field label="活動名" name="title" required maxLength={100} />
            <label class="field">
              <span>募集の内容</span>
              <textarea
                class="textarea"
                name="body"
                rows={4}
                maxLength={1000}
                required
                placeholder="どんな活動で、誰と何をしたいかを書きます。"
              />
            </label>
            <Field
              label="求める役割（読点か改行で区切り）"
              name="roles"
              required
              maxLength={300}
              help="例：UI設計、回路、発表"
            />
            <div class="field-pair">
              <Field label="募集のURL（任意）" name="url" type="url" maxLength={1500} />
              <Field label="応募締切（任意）" name="deadline" type="date" />
            </div>
            <button class="btn btn-primary">募集する</button>
          </form>
        ) : (
          <form method="post" action="/timeline/posts" class="social-form">
            <input type="hidden" name="kind" value="progress" />
            <label class="field">
              <span>制作の進み具合</span>
              <textarea
                class="textarea"
                name="body"
                rows={3}
                maxLength={280}
                required
                placeholder="今日できたことや詰まっていることを280字まで書けます。"
              />
            </label>
            {!!published.length && (
              <label class="field">
                <span>添付する作品（任意）</span>
                <select class="select" name="work_id">
                  <option value="">添付しない</option>
                  {published.map((w) => (
                    <option value={w.id}>{w.data.title}</option>
                  ))}
                </select>
              </label>
            )}
            <button class="btn btn-primary">投稿する</button>
          </form>
        )}
      </section>
      <nav class="tl-filters" aria-label="絞り込み">
        <a
          class="badge badge-ghost"
          href="/home"
          aria-current={view.filter === 'all' && !view.role ? 'page' : undefined}
        >
          すべて
        </a>
        <a
          class="badge badge-ghost"
          href="/home?filter=recruit"
          aria-current={view.filter === 'recruit' && !view.role ? 'page' : undefined}
        >
          仲間募集
        </a>
        {roles.map((r) => (
          <a
            class="badge badge-ghost"
            href={`/home?role=${encodeURIComponent(r)}`}
            aria-current={view.role === r ? 'page' : undefined}
          >
            {r}
          </a>
        ))}
      </nav>
      {items.length ? (
        <div class="tl-list">
          {items.map((item: TimelineItem) =>
            item.type === 'post' ? (
              <PostCard post={item.post} user={user} back={back} />
            ) : (
              <div>
                <ShareEvent work={item.work} />
                <form method="post" action={`/works/${item.work.work_id}/react`} class="tl-react">
                  <button
                    class="btn btn-ghost btn-sm reaction"
                    aria-pressed={timeline.store.reacted(user.id, item.work.work_id)}
                  >
                    {timeline.store.reacted(user.id, item.work.work_id)
                      ? '気になるに追加済み'
                      : '気になる'}
                    <span>{timeline.store.reactionCount(item.work.work_id)}</span>
                  </button>
                </form>
              </div>
            ),
          )}
        </div>
      ) : (
        <div class="feed-empty">
          <h3>投稿はありません</h3>
          <p>進捗や仲間募集を投稿すると表示されます。</p>
        </div>
      )}
    </section>
  );
}
function JoinItem({ join, user }: { join: Join; user: User }) {
  const mine = join.applicant_id === user.id;
  const other = mine ? join.owner_contact : join.applicant_contact;
  return (
    <article class="card social-card">
      <div class="section-heading">
        <h3>
          <a href={`/u/${join.applicant_handle}`}>{join.applicant_name}</a>さんの参加希望
        </h3>
        <span class="badge badge-outline">{joinLabels[join.state]}</span>
      </div>
      <p class="tl-meta">希望する役割：{join.role}</p>
      <p class="preserve-lines">{join.message}</p>
      {join.work && <EmbeddedWork work={join.work} />}
      {join.state === 'pending' && (
        <div class="social-actions">
          {(mine ? ['cancelled'] : ['accepted', 'declined']).map((state) => (
            <form method="post" action={`/timeline/joins/${join.id}/state`}>
              <input type="hidden" name="state" value={state} />
              <button class={state === 'accepted' ? 'btn btn-primary' : 'btn btn-outline'}>
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
        <div class="contact-panel">
          <h4>連絡先の共有</h4>
          <p>相手だけに連絡先を共有できます。空欄で保存すると共有を取り消せます。</p>
          {other && (
            <p>
              <a href={other} target="_blank" rel="noopener noreferrer">
                相手が共有した連絡先を開く
              </a>
            </p>
          )}
          <form method="post" action={`/timeline/joins/${join.id}/contact`} class="social-form">
            <Field
              label="自分の連絡先URL"
              name="contact"
              type="url"
              value={mine ? join.applicant_contact : join.owner_contact}
              maxLength={1500}
            />
            <button class="btn btn-outline">連絡先を保存</button>
          </form>
        </div>
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
      <PageHeading
        title="Post"
        action={
          <a class="btn btn-outline" href="/home">
            ホームへ戻る
          </a>
        }
      />
      {notice && (
        <p role="status" class="alert">
          {notice}
        </p>
      )}
      <div class="timeline">
        <PostCard post={post} user={user} back={back} detail />
        <div class="tl-menu-row">
          <Moderation user={user} post={post} back="/home" />
        </div>
        <section id="replies" class="social-section">
          <h2>返信</h2>
          <div class="social-stack">
            {replies.map((r) => (
              <article class="tl-item tl-reply">
                <Author name={r.display_name} handle={r.handle} at={r.created_at} />
                <p class="preserve-lines">{r.body}</p>
                <Moderation user={user} post={r} back={back} />
              </article>
            ))}
            {!replies.length && <p class="quiet">まだ返信はありません。</p>}
          </div>
          <form method="post" action={`/timeline/${id}/replies`} class="social-form">
            <label class="field">
              <span>返信</span>
              <textarea class="textarea" name="body" rows={3} maxLength={500} required />
            </label>
            <button class="btn btn-primary">返信する</button>
          </form>
        </section>
        {post.kind === 'recruit' && (
          <section id="joins" class="social-section">
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
                  class="social-form tl-join"
                >
                  <h3>参加したい</h3>
                  <Field label="自分の役割" name="role" required maxLength={100} />
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
