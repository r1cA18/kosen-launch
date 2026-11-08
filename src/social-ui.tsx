import type { User, Published, Work } from './store';
import { Layout, Field, PageHeading, Empty } from './ui';
import type { SocialStore } from './social';
import type { Opportunities, OpportunityInput } from './opportunities';

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
            <p class="quiet">
              <a href={`/u/${q.handle}`}>{q.display_name}</a> · {q.created_at.slice(0, 10)}
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
          <p>イベント、役割、最初の一歩を指定して誘えます。内容は相手にだけ届きます。</p>
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
              <span>この作品を見て一緒にしたいこと</span>
              <textarea class="textarea" name="purpose" required rows={3} maxLength={1000} />
            </label>
            <div class="field-pair">
              <Field label="自分が担当したいこと" name="sender_role" required maxLength={200} />
              <Field label="相手に相談したい役割" name="recipient_role" required maxLength={200} />
            </div>
            <Field label="最初の一歩・予定" name="next_step" required maxLength={500} />
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
export function ConnectionsPage({
  user,
  social,
  notice,
}: {
  user: User;
  social: SocialStore;
  notice?: string;
}) {
  const invitations = social.invitations(user.id),
    notices = social.notices(user.id),
    blocks = social.blocks(user.id);
  return (
    <Layout title="交流" user={user} active="connections">
      <PageHeading title="Messages" description="質問への返信と誘いを確認できます。" />
      {notice && (
        <p role="status" class="alert">
          {notice}
        </p>
      )}
      <section class="social-section">
        <div class="section-heading">
          <h2>Notifications</h2>
          <form method="post" action="/social/notices/read">
            <button class="btn btn-ghost btn-sm">すべて既読にする</button>
          </form>
        </div>
        {notices.length ? (
          <ul class="notice-list">
            {notices.map((n) => (
              <li>
                <a href={n.href}>
                  {!n.read && <span class="badge badge-outline">未読</span>}
                  {n.message}
                </a>
                <time>{n.created_at.slice(0, 10)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p class="quiet">お知らせはありません。</p>
        )}
      </section>
      <section class="social-section">
        <h2>Invitations</h2>
        <p class="quiet">
          受け入れてもイベントへの応募にはなりません。参加条件と予定を確認してください。
        </p>
        {invitations.length ? (
          <div class="social-stack">
            {invitations.map((i) => (
              <article class="card social-card">
                <div class="section-heading">
                  <h3>{i.event_title}</h3>
                  <span class="badge badge-outline">{invitationLabels[i.state]}</span>
                </div>
                <p class="quiet">
                  {i.sender_name} → {i.recipient_name} · きっかけは「{i.title}」
                </p>
                <a href={i.event_url} target="_blank" rel="noopener noreferrer">
                  イベント・募集の情報を見る
                </a>
                <p class="preserve-lines">{i.purpose}</p>
                <dl class="role-list">
                  <dt>{i.sender_name}の希望する役割</dt>
                  <dd>{i.sender_role}</dd>
                  <dt>{i.recipient_name}に相談したい役割</dt>
                  <dd>{i.recipient_role}</dd>
                  <dt>最初の一歩</dt>
                  <dd>{i.next_step}</dd>
                </dl>
                {i.state === 'pending' && (
                  <div class="social-actions">
                    {(i.recipient_id === user.id ? ['accepted', 'declined'] : ['cancelled']).map(
                      (state) => (
                        <form method="post" action={`/social/invitations/${i.id}/state`}>
                          <input type="hidden" name="state" value={state} />
                          <button
                            class={state === 'accepted' ? 'btn btn-primary' : 'btn btn-outline'}
                          >
                            {state === 'accepted'
                              ? '誘いを受け入れる'
                              : state === 'declined'
                                ? '今回は見送る'
                                : '誘いを取り消す'}
                          </button>
                        </form>
                      ),
                    )}
                  </div>
                )}
                {i.state === 'accepted' && (
                  <div class="contact-panel">
                    <h4>連絡先の共有</h4>
                    <p>相手だけに連絡先を共有できます。空欄で保存すると共有を取り消せます。</p>
                    {(i.sender_id === user.id ? i.recipient_contact : i.sender_contact) && (
                      <p>
                        <a
                          href={i.sender_id === user.id ? i.recipient_contact : i.sender_contact}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          相手が共有した連絡先を開く
                        </a>
                      </p>
                    )}
                    <form
                      method="post"
                      action={`/social/invitations/${i.id}/contact`}
                      class="social-form"
                    >
                      <Field
                        label="自分の連絡先URL"
                        name="contact"
                        type="url"
                        value={i.sender_id === user.id ? i.sender_contact : i.recipient_contact}
                        maxLength={1500}
                      />
                      <button class="btn btn-outline">連絡先を保存</button>
                    </form>
                  </div>
                )}
                <details>
                  <summary>相手との交流を停止する</summary>
                  <form
                    method="post"
                    action={`/social/blocks/${i.sender_id === user.id ? i.recipient_id : i.sender_id}`}
                  >
                    <button class="btn btn-ghost btn-sm">ブロックして連絡先の共有を取り消す</button>
                  </form>
                </details>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="まだ誘いはありません" href="/home" label="作品を探す">
            作品のページから誘いを送れます。
          </Empty>
        )}
      </section>
      {!!blocks.length && (
        <section class="social-section">
          <h2>ブロックしている利用者</h2>
          {blocks.map((b) => (
            <form class="social-actions" method="post" action={`/social/blocks/${b.id}/remove`}>
              <span>{b.display_name}</span>
              <button class="btn btn-ghost btn-sm">ブロックを解除</button>
            </form>
          ))}
          <p class="quiet">ブロックは交流の停止です。公開ページは匿名でも閲覧できます。</p>
        </section>
      )}
    </Layout>
  );
}
const states = {
  saved: '参加候補',
  applied: '応募済み',
  participated: '参加済み',
  dismissed: '見送り',
};
function OpportunityFields({ value }: { value?: OpportunityInput }) {
  return (
    <>
      <Field
        label="イベント・活動の名前"
        name="title"
        value={value?.title}
        required
        maxLength={150}
      />
      <Field
        label="公式・募集ページのURL"
        name="url"
        type="url"
        value={value?.url}
        required
        maxLength={1500}
      />
      <div class="field-pair">
        <Field label="開催日（分かる場合）" name="date" type="date" value={value?.date} />
        <Field label="応募締切（分かる場合）" name="deadline" type="date" value={value?.deadline} />
      </div>
      <Field label="場所・オンライン" name="location" value={value?.location} maxLength={200} />
      <label class="field">
        <span>公式ページで確認した参加条件</span>
        <textarea class="textarea" name="conditions" rows={3} maxLength={2000}>
          {value?.conditions}
        </textarea>
      </label>
      <label class="field">
        <span>既存作品の持ち込み</span>
        <select class="select" name="existing_work">
          {[
            ['unknown', '未確認'],
            ['allowed', '可能'],
            ['forbidden', '不可・新規制作のみ'],
          ].map(([v, l]) => (
            <option value={v} selected={value?.existing_work === v}>
              {l}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
export function OpportunitiesPage({
  user,
  opportunities,
  works,
}: {
  user: User;
  opportunities: Opportunities;
  works: Work[];
}) {
  const items = opportunities.list(user.id);
  const tags = [...new Set(works.flatMap((w) => w.data.tags))].slice(0, 5);
  return (
    <Layout title="機会" user={user} active="opportunities">
      <PageHeading
        title="Opportunities"
        description="イベントの情報を保存して、準備案を作成できます。"
      />
      <section class="card social-card">
        <h2>募集を探す</h2>
        <p>リンク先で最新の募集と参加条件を確認できます。</p>
        <div class="tags">
          {['高専 ハッカソン', ...tags.map((t) => `${t} LT イベント`)].map((q) => (
            <a
              class="btn btn-outline btn-sm"
              href={`https://www.google.com/search?q=${encodeURIComponent(q)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {q}
            </a>
          ))}
        </div>
      </section>
      <section class="social-section">
        <details class="card social-card">
          <summary>機会を追加する</summary>
          <form method="post" action="/opportunities" class="social-form">
            <OpportunityFields />
            <button class="btn btn-primary">参加候補として保存</button>
          </form>
        </details>
      </section>
      <div class="social-stack">
        {items.map((o) => (
          <article class="card social-card">
            <div class="section-heading">
              <h2>
                <a href={`/opportunities/${o.id}`}>{o.title}</a>
              </h2>
              <span class="badge badge-outline">{states[o.state]}</span>
            </div>
            <p>
              {o.date || '開催日未確認'} · {o.location || '場所未確認'}
            </p>
            <p>
              応募締切：{o.deadline || '未確認'}
              {o.deadline &&
              o.deadline < new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
                ? '（過去の日付です）'
                : ''}
            </p>
            <a href={`/opportunities/${o.id}`}>詳細を見る</a>
          </article>
        ))}
      </div>
      {!items.length && <p class="feed-empty">参加候補はありません。募集のURLから追加できます。</p>}
    </Layout>
  );
}
export function OpportunityPage({
  adviceId,
  user,
  id,
  opportunities,
  works,
}: {
  user: User;
  id: string;
  opportunities: Opportunities;
  works: Work[];
  adviceId?: string;
}) {
  const o = opportunities.get(user.id, id),
    advice = opportunities.latest(user.id, id, adviceId);
  return (
    <Layout title={o.title} user={user} active="opportunities">
      <PageHeading
        title={o.title}
        description="保存した候補です。応募は公式ページで行ってください。"
      />
      <div class="social-stack">
        <section class="card social-card">
          <a href={o.url} target="_blank" rel="noopener noreferrer">
            公式・募集ページを確認
          </a>
          <p>
            開催日：{o.date || '未確認'} · 応募締切：{o.deadline || '未確認'}
          </p>
          <p>{o.location || '場所未確認'}</p>
          <p class="preserve-lines">{o.conditions || '参加条件を確認してください。'}</p>
          <p>
            既存作品：
            {o.existing_work === 'allowed'
              ? '持ち込み可能として保存済み'
              : o.existing_work === 'forbidden'
                ? '持ち込み不可・新規制作のみ'
                : '可否を確認してください'}
          </p>
          <form method="post" action={`/opportunities/${id}/state`} class="social-actions">
            <label class="field">
              <span>自分の参加状況</span>
              <select name="state" class="select">
                {Object.entries(states).map(([key, label]) => (
                  <option value={key} selected={key === o.state}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button class="btn btn-outline">状態を保存</button>
          </form>
          <details>
            <summary>保存した情報を編集する</summary>
            <form method="post" action={`/opportunities/${id}/edit`} class="social-form">
              <OpportunityFields value={o} />
              <button class="btn btn-outline">情報を更新</button>
            </form>
          </details>
        </section>
        <section class="card social-card">
          <h2>準備案</h2>
          <p>
            選んだ作品の文章と保存したイベント情報をClaudeへ送ります。根拠メモと画像ファイルと学校の登録情報は送りません。公式情報の自動確認は行いません。
          </p>
          {!opportunities.enabled() && (
            <p role="status" class="alert">
              AIの接続は未設定です。機会の保存と手動の準備は利用できます。
            </p>
          )}
          <form method="post" action={`/opportunities/${id}/recommend`} class="social-form">
            <fieldset>
              <legend>使いたい作品・経験（1〜5件）</legend>
              {works.map((w) => (
                <label class="check-field">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm"
                    name="work_ids"
                    value={w.id}
                  />
                  {w.data.title}
                </label>
              ))}
            </fieldset>
            <button class="btn btn-primary" disabled={!opportunities.enabled() || !works.length}>
              準備案を作成
            </button>
          </form>
          {advice && (
            <div class="answer">
              <p class="quiet">{advice.created_at.slice(0, 10)}の保存情報に基づく準備案</p>
              {advice.stale && (
                <p role="status" class="alert">
                  作品またはイベント情報が更新されています。最新の内容で準備案を作り直してください。
                </p>
              )}
              {advice.state === 'failed' ? (
                <p role="alert">{advice.error}</p>
              ) : advice.state === 'running' ? (
                <p>処理中です。少し待って画面を読み直してください。</p>
              ) : (
                advice.result && (
                  <>
                    <p>{advice.result.reason}</p>
                    <p>
                      生かせる経験：
                      {advice.result.work_ids.map((id) => (
                        <a href={`/works/${id}`}>
                          {works.find((w) => w.id === id)?.data.title ?? '作品'}{' '}
                        </a>
                      ))}
                    </p>
                    <h3>取り組む題材</h3>
                    <p>{advice.result.project_idea}</p>
                    <h3>相談できる役割</h3>
                    <p>{advice.result.role}</p>
                    <h3>先に確認すること</h3>
                    <ul>
                      {advice.result.checks.map((s) => (
                        <li>{s}</li>
                      ))}
                    </ul>
                    <h3>次の一歩</h3>
                    <ol>
                      {advice.result.steps.map((s) => (
                        <li>{s}</li>
                      ))}
                    </ol>
                  </>
                )
              )}
            </div>
          )}
        </section>
        <section class="card social-card">
          <h2>仲間を探す</h2>
          <p>共有作品から相手を選び、活動名と役割を指定して誘えます。</p>
          <a class="btn btn-outline" href="/home">
            作品から仲間を探す
          </a>
        </section>
      </div>
    </Layout>
  );
}
