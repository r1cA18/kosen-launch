import type { User, Published, Work } from './store';
import { Layout, Field, PageHeading, Avatar } from './ui';
import type { Invitation, Notice, SocialStore } from './social';
import type { ConversationSummary, Message, Person, TimelineStore } from './timeline';
import { ContactPanel, Icon, JoinItem, Time, type IconName } from './timeline-ui';

export function Conversation({
  work,
  user,
  social,
}: {
  work: Published;
  user?: User;
  social: SocialStore;
}) {
  if (!work.share_to_feed) return null;
  let owner: string;
  try {
    owner = social.shared(work.work_id, user?.id).owner_id;
  } catch {
    return <p class="quiet">この作品との交流は利用できません。</p>;
  }
  const questions = social.questions(work.work_id, user?.id);
  return (
    <section id="conversation" class="conversation">
      <div class="section-heading">
        <h2>Questions</h2>
        <span>{questions.length}件の質問</span>
      </div>
      <p>作品について質問できます。質問と返信は公開されます。</p>
      {user ? (
        <form method="post" action={`/social/works/${work.work_id}/questions`} class="social-form">
          <label class="field">
            <span>作品への質問</span>
            <textarea
              class="textarea"
              name="body"
              rows={3}
              maxLength={1000}
              required
              placeholder="どのように役割を分担しましたか？"
            />
          </label>
          <button class="btn btn-primary">質問を送る</button>
        </form>
      ) : (
        <a class="btn btn-outline" href="/login">
          ログインして質問する
        </a>
      )}
      <div class="social-stack">
        {questions.map((q) => (
          <article class="card social-card">
            <p class="x-question-head">
              <Avatar name={q.display_name} asset={q.avatar} size="sm" />
              <a href={`/u/${q.handle}`}>{q.display_name}</a>
              <span class="quiet">
                @{q.handle} · <Time at={q.created_at} />
              </span>
            </p>
            <p class="preserve-lines">{q.body}</p>
            {q.answer && (
              <div class="answer">
                <span class="plain-label">作者からの返信</span>
                <p class="preserve-lines">{q.answer}</p>
              </div>
            )}
            {user?.id === owner && (
              <details>
                <summary>返信する・返信を編集する</summary>
                <form method="post" action={`/social/questions/${q.id}/answer`} class="social-form">
                  <label class="field">
                    <span>作者からの返信</span>
                    <textarea name="answer" class="textarea" required rows={3} maxLength={2000}>
                      {q.answer}
                    </textarea>
                  </label>
                  <button class="btn btn-outline">返信を保存</button>
                </form>
              </details>
            )}
            {user && (
              <div class="social-actions">
                {(user.id === owner || user.id === q.author_id) && (
                  <form method="post" action={`/social/questions/${q.id}/delete`}>
                    <button class="btn btn-ghost btn-sm">質問を削除</button>
                  </form>
                )}
                {user.id !== q.author_id && (
                  <details>
                    <summary>通報・ブロック</summary>
                    <form
                      class="social-form"
                      method="post"
                      action={`/social/questions/${q.id}/report`}
                    >
                      <Field label="通報する理由" name="reason" required maxLength={1000} />
                      <button class="btn btn-outline btn-sm">通報して自分の画面で非表示</button>
                    </form>
                    <form method="post" action={`/social/blocks/${q.author_id}`}>
                      <button class="btn btn-ghost btn-sm">この利用者をブロック</button>
                    </form>
                  </details>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {user && user.id !== owner && (
        <section class="card social-card invite-panel">
          <h3>活動に誘う</h3>
          <p>活動名と双方の役割と最初の作業を指定して誘えます。内容は相手にだけ表示されます。</p>
          <form
            method="post"
            action={`/social/works/${work.work_id}/invitations`}
            class="social-form"
          >
            <Field label="イベント・活動の名前" name="event_title" required maxLength={150} />
            <Field
              label="イベント・募集のURL"
              name="event_url"
              type="url"
              required
              maxLength={1500}
            />
            <label class="field">
              <span>誘う理由</span>
              <textarea class="textarea" name="purpose" required rows={3} maxLength={1000} />
            </label>
            <div class="field-pair">
              <Field label="自分が担当したいこと" name="sender_role" required maxLength={200} />
              <Field label="相手に相談したい役割" name="recipient_role" required maxLength={200} />
            </div>
            <Field label="最初の作業" name="next_step" required maxLength={500} />
            <button class="btn btn-primary">誘う</button>
          </form>
        </section>
      )}
    </section>
  );
}
const invitationLabels = {
  pending: '返事待ち',
  accepted: '受け入れ済み',
  declined: '見送り',
  cancelled: '取り消し',
};
const backTo = (handle: string) => `/connections?with=${encodeURIComponent(handle)}`;
function preview(m: Message) {
  if (m.type === 'invitation') return `活動への誘い：${m.invitation.event_title}`;
  if (m.type === 'join') return `参加希望：${m.post_title}`;
  return m.body;
}
function InvitationCard({ i, user, back }: { i: Invitation; user: User; back: string }) {
  const sent = i.sender_id === user.id;
  return (
    <article class="x-card x-invite">
      <header class="x-card-head">
        <span class="x-card-icon">
          <Icon name="send" />
        </span>
        <div>
          <strong>活動への誘い</strong>
          <span class="quiet">作品「{i.title}」から</span>
        </div>
        <span class={`x-state x-state-${i.state}`}>{invitationLabels[i.state]}</span>
      </header>
      <h3>{i.event_title}</h3>
      <a class="x-link" href={i.event_url} target="_blank" rel="noopener noreferrer">
        イベント・募集の情報を見る
      </a>
      <p class="preserve-lines">{i.purpose}</p>
      <dl class="x-roles">
        <dt>{i.sender_name}さんの担当</dt>
        <dd>{i.sender_role}</dd>
        <dt>{i.recipient_name}さんに相談したい役割</dt>
        <dd>{i.recipient_role}</dd>
        <dt>最初の作業</dt>
        <dd>{i.next_step}</dd>
      </dl>
      {i.state === 'pending' && (
        <div class="x-card-actions">
          {(sent ? ['cancelled'] : ['accepted', 'declined']).map((state) => (
            <form method="post" action={`/social/invitations/${i.id}/state`}>
              <input type="hidden" name="state" value={state} />
              <input type="hidden" name="back" value={back} />
              <button class={state === 'accepted' ? 'btn btn-sm btn-primary' : 'btn btn-sm x-btn'}>
                {state === 'accepted'
                  ? '誘いを受け入れる'
                  : state === 'declined'
                    ? '今回は見送る'
                    : '誘いを取り消す'}
              </button>
            </form>
          ))}
        </div>
      )}
      {i.state === 'accepted' && (
        <ContactPanel
          action={`/social/invitations/${i.id}/contact`}
          mine={sent ? i.sender_contact : i.recipient_contact}
          other={sent ? i.recipient_contact : i.sender_contact}
          back={back}
        />
      )}
      <p class="x-card-note">受け入れてもイベントへの応募にはなりません。</p>
    </article>
  );
}
function Bubble({ m, user, person }: { m: Message; user: User; person: Person }) {
  const mine = m.from === user.id;
  if (m.type === 'invitation' || m.type === 'join')
    return (
      <li class={`x-msg x-msg-card ${mine ? 'is-mine' : ''}`}>
        {m.type === 'invitation' ? (
          <InvitationCard i={m.invitation} user={user} back={backTo(person.handle)} />
        ) : (
          <JoinItem
            join={m.join}
            user={user}
            back={backTo(person.handle)}
            title={
              <a class="quiet" href={`/timeline/${m.join.post_id}`}>
                募集「{m.post_title}」
              </a>
            }
          />
        )}
        <Time at={m.at} />
      </li>
    );
  return (
    <li class={`x-msg ${mine ? 'is-mine' : ''}`}>
      <a class="x-msg-context" href={m.work_href}>
        {m.type === 'question' ? '作品への質問' : '作品への返信'}・{m.work_title}
      </a>
      <p class="x-bubble preserve-lines">{m.body}</p>
      <Time at={m.at} />
    </li>
  );
}
function Composer({
  user,
  person,
  timeline,
}: {
  user: User;
  person: Person;
  timeline: TimelineStore;
}) {
  const open = timeline.openQuestion(user.id, person.id);
  const back = backTo(person.handle);
  if (open)
    return (
      <form
        class="x-dm-composer"
        method="post"
        action={`/social/questions/${open.question_id}/answer`}
      >
        <input type="hidden" name="back" value={back} />
        <p class="x-dm-hint">
          作品「{open.work_title}」への質問に返信します。返信は作品ページで公開されます。
        </p>
        <div class="x-dm-input">
          <textarea
            class="x-compose-text"
            name="answer"
            rows={1}
            maxLength={2000}
            required
            aria-label="返信"
            placeholder="返信を入力"
          />
          <button class="x-send" aria-label="送信">
            <Icon name="send" />
          </button>
        </div>
      </form>
    );
  const works = timeline.store
    .published(person.handle)
    .filter((w) => w.share_to_feed && !timeline.social.blocked(user.id, person.id));
  if (!works.length)
    return (
      <p class="x-dm-composer x-dm-hint">
        {person.display_name}
        さんの共有作品がないため、ここからは送信できません。相手からの質問に返信できます。
      </p>
    );
  return (
    <form class="x-dm-composer" method="post" action="/social/questions">
      <input type="hidden" name="back" value={back} />
      <label class="x-dm-hint">
        作品への質問として送信します。質問と返信は作品ページで公開されます。
        <select class="select select-sm" name="work_id" aria-label="質問する作品">
          {works.map((w) => (
            <option value={w.work_id}>{w.data.title}</option>
          ))}
        </select>
      </label>
      <div class="x-dm-input">
        <textarea
          class="x-compose-text"
          name="body"
          rows={1}
          maxLength={1000}
          required
          aria-label="メッセージ"
          placeholder="メッセージを入力"
        />
        <button class="x-send" aria-label="送信">
          <Icon name="send" />
        </button>
      </div>
    </form>
  );
}
function ConversationList({
  list,
  selected,
  user,
}: {
  list: ConversationSummary[];
  selected?: string;
  user: User;
}) {
  if (!list.length)
    return (
      <div class="x-dm-empty">
        <h3>メッセージはまだありません</h3>
        <p>作品への質問や誘い、仲間募集への参加希望がここにまとまります。</p>
        <a class="btn btn-primary btn-sm" href="/home">
          ホームで探す
        </a>
      </div>
    );
  return (
    <ul class="x-dm-rows">
      {list.map((c) => (
        <li>
          <a
            class={`x-dm-row ${c.unread ? 'is-unread' : ''}`}
            href={backTo(c.person.handle)}
            aria-current={selected === c.person.id ? 'page' : undefined}
          >
            <Avatar name={c.person.display_name} asset={c.person.avatar} />
            <span class="x-dm-row-main">
              <span class="x-dm-row-head">
                <strong>{c.person.display_name}</strong>
                <span class="x-handle">@{c.person.handle}</span>
                <span class="x-sep" aria-hidden="true">
                  ·
                </span>
                <Time at={c.last.at} />
              </span>
              <span class="x-dm-row-text">
                {c.last.from === user.id ? 'あなた: ' : ''}
                {preview(c.last)}
              </span>
            </span>
            {c.unread && <span class="x-dot" aria-label="未読" />}
          </a>
        </li>
      ))}
    </ul>
  );
}
function noticeKind(n: Notice): IconName {
  if (/受け入れ|見送|取り消/.test(n.message)) return 'check';
  if (n.href.startsWith('/timeline/') && n.message.includes('返信')) return 'reply';
  if (n.message.includes('質問')) return 'reply';
  if (n.message.includes('誘い')) return 'send';
  if (n.message.includes('参加希望')) return 'join';
  return 'bell';
}
function Notifications({
  user,
  social,
  timeline,
}: {
  user: User;
  social: SocialStore;
  timeline: TimelineStore;
}) {
  const notices = social.notices(user.id);
  return (
    <section class="x-notices x-list" aria-label="通知">
      <header class="x-list-head">
        <span>{notices.filter((n) => !n.read).length}件の未読</span>
        <form method="post" action="/social/notices/read">
          <button class="btn btn-ghost btn-sm">すべて既読にする</button>
        </form>
      </header>
      {notices.length ? (
        <ul>
          {notices.map((n) => {
            const actor = timeline.person(n.actor_id),
              kind = noticeKind(n),
              href =
                kind === 'reply' && n.href.startsWith('/timeline/') ? n.href : backTo(actor.handle);
            return (
              <li>
                <a class={`x-notice ${n.read ? '' : 'is-unread'}`} href={href}>
                  <span class={`x-notice-icon x-notice-${kind}`}>
                    <Icon name={kind} />
                  </span>
                  <span class="x-notice-main">
                    <Avatar name={actor.display_name} asset={actor.avatar} size="sm" />
                    <span class="x-notice-text">{n.message}</span>
                    <Time at={n.created_at} />
                  </span>
                  {!n.read && <span class="x-dot" aria-label="未読" />}
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="x-quiet-row">通知はありません。</p>
      )}
    </section>
  );
}
export function ConnectionsPage({
  user,
  social,
  timeline,
  tab = 'messages',
  person,
  notice,
}: {
  user: User;
  social: SocialStore;
  timeline: TimelineStore;
  tab?: 'messages' | 'notifications';
  person?: Person;
  notice?: string;
}) {
  const list = timeline.conversations(user.id),
    unread = social.notices(user.id).filter((n) => !n.read).length,
    blocks = social.blocks(user.id),
    thread = person ? timeline.thread(user.id, person.id) : [];
  return (
    <Layout title="Messages" user={user} active="connections">
      <PageHeading title="Messages" />
      {notice && (
        <p role="status" class="alert">
          {notice}
        </p>
      )}
      <nav class="x-tabs x-page-tabs" aria-label="表示の切り替え">
        <a href="/connections" aria-current={tab === 'messages' ? 'page' : undefined}>
          メッセージ
        </a>
        <a
          href="/connections?tab=notifications"
          aria-current={tab === 'notifications' ? 'page' : undefined}
        >
          通知{!!unread && <span class="x-count">{unread}</span>}
        </a>
      </nav>
      {tab === 'notifications' ? (
        <Notifications user={user} social={social} timeline={timeline} />
      ) : (
        <div class={`x-dm ${person ? 'is-open' : ''}`}>
          <aside class="x-dm-list x-list" aria-label="会話">
            <ConversationList list={list} selected={person?.id} user={user} />
          </aside>
          <section class="x-dm-thread x-list" aria-label="会話の内容">
            {person ? (
              <>
                <header class="x-dm-head">
                  <a class="x-back x-dm-back" href="/connections" aria-label="会話一覧へ戻る">
                    <Icon name="back" />
                  </a>
                  <Avatar name={person.display_name} asset={person.avatar} size="sm" />
                  <a class="x-dm-who" href={`/u/${person.handle}`}>
                    <strong>{person.display_name}</strong>
                    <span class="x-handle">@{person.handle}</span>
                  </a>
                  <details class="x-more">
                    <summary aria-label="その他の操作">
                      <Icon name="more" />
                    </summary>
                    <div class="x-more-panel">
                      <a class="x-menu-item" href={`/u/${person.handle}`}>
                        プロフィールを見る
                      </a>
                      <form method="post" action={`/social/blocks/${person.id}`}>
                        <button class="x-menu-item x-danger">
                          ブロックして連絡先の共有を取り消す
                        </button>
                      </form>
                    </div>
                  </details>
                </header>
                <div class="x-msgs-scroll">
                  <ol class="x-msgs">
                    {thread.map((m) => (
                      <Bubble m={m} user={user} person={person} />
                    ))}
                    {!thread.length && (
                      <li class="x-dm-start">
                        <Avatar name={person.display_name} asset={person.avatar} size="lg" />
                        <strong>{person.display_name}</strong>
                        <span class="x-handle">@{person.handle}</span>
                        <p>まだやり取りはありません。</p>
                      </li>
                    )}
                  </ol>
                </div>
                <Composer user={user} person={person} timeline={timeline} />
              </>
            ) : (
              <div class="x-dm-placeholder">
                <h2>会話を選んでください</h2>
                <p>質問と返信、誘い、参加希望を相手ごとに表示します。</p>
              </div>
            )}
          </section>
        </div>
      )}
      {!!blocks.length && tab === 'messages' && (
        <details class="x-blocks">
          <summary>ブロックしている利用者（{blocks.length}人）</summary>
          {blocks.map((b) => (
            <form class="social-actions" method="post" action={`/social/blocks/${b.id}/remove`}>
              <span>{b.display_name}</span>
              <button class="btn btn-ghost btn-sm">ブロックを解除</button>
            </form>
          ))}
          <p class="quiet">ブロックは交流の停止です。公開ページは匿名でも閲覧できます。</p>
        </details>
      )}
    </Layout>
  );
}
