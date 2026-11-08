import type { User, Work } from './store';
import { Layout, Field, PageHeading } from './ui';
import { today, type Opportunities, type OpportunityInput, type Suggestion } from './opportunities';
import type { DiscoveryRun } from './discovery';

const states = {
  saved: '保存済み',
  applied: '参加予定',
  participated: '参加済み',
  dismissed: '見送り',
};
const kinds = {
  hackathon: 'ハッカソン',
  contest: 'コンテスト',
  meetup: '勉強会',
  internship: 'インターン',
  other: 'イベント',
};
const formats = { online: 'オンライン', offline: '会場', hybrid: '会場とオンライン', unknown: '' };
const time = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const short = (date: string) =>
  date ? `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日` : '';
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
export type EventsTab = 'foryou' | 'saved' | 'plans';
export type DiscoveryStatus = { enabled: boolean; running: boolean; last: DiscoveryRun | null };
function SuggestionCard({ s }: { s: Suggestion }) {
  const where = s.location || formats[s.format];
  return (
    <article class="card ev-card">
      <div class="ev-meta">
        <span class="badge badge-outline">{kinds[s.kind]}</span>
        <span>{s.source_domain}</span>
      </div>
      <h2>{s.title}</h2>
      <dl class="ev-facts">
        <div>
          <dt>開催</dt>
          <dd>{short(s.date) || '未確認'}</dd>
        </div>
        <div>
          <dt>締切</dt>
          <dd>{short(s.deadline) || '未確認'}</dd>
        </div>
        <div>
          <dt>場所</dt>
          <dd>{where || '未確認'}</dd>
        </div>
      </dl>
      <div class="ev-why">
        <h3>あなたに合う理由</h3>
        <p>{s.reason}</p>
        {s.work_titles.length > 0 && (
          <p class="ev-works">
            {s.work_titles.map((t, i) => (
              <a href={`/works/${s.work_ids[i]}`}>{t}</a>
            ))}
          </p>
        )}
        {s.role && (
          <>
            <h3>できる役割</h3>
            <p>{s.role}</p>
          </>
        )}
      </div>
      {s.audience && <p class="quiet">対象：{s.audience}</p>}
      <div class="ev-actions">
        <form method="post" action={`/opportunities/suggestions/${s.id}/save`}>
          <button class="btn btn-primary btn-sm">保存</button>
        </form>
        <form method="post" action={`/opportunities/suggestions/${s.id}/dismiss`}>
          <button class="btn btn-ghost btn-sm">興味なし</button>
        </form>
        <a class="btn btn-outline btn-sm" href={s.url} target="_blank" rel="noopener noreferrer">
          公式ページ
        </a>
      </div>
      <p class="quiet ev-source">
        {s.found_via === 'rustxng' ? 'RustXNGの検索結果' : 'Claudeのweb検索結果'}
        から選びました。日付と条件は公式ページで確認してください。
      </p>
    </article>
  );
}
function SavedList({ items, empty }: { items: ReturnType<Opportunities['list']>; empty: string }) {
  const day = today();
  if (!items.length) return <p class="feed-empty">{empty}</p>;
  return (
    <div class="ev-list">
      {items.map((o) => (
        <a class="card ev-row" href={`/opportunities/${o.id}`}>
          <span class="ev-row-title">{o.title}</span>
          <span class="quiet">
            {short(o.date) || '開催日未確認'} · 締切 {short(o.deadline) || '未確認'}
            {o.deadline && o.deadline < day ? '（過ぎています）' : ''} ·{' '}
            {o.location || '場所未確認'}
          </span>
          <span class="badge badge-outline">{states[o.state]}</span>
        </a>
      ))}
    </div>
  );
}
export function EventsPage({
  user,
  tab,
  opportunities,
  status,
}: {
  user: User;
  tab: EventsTab;
  opportunities: Opportunities;
  status: DiscoveryStatus;
}) {
  const items = opportunities.suggestions(user.id),
    list = opportunities.list(user.id),
    saved = list.filter((o) => o.state === 'saved'),
    plans = list.filter((o) => o.state === 'applied' || o.state === 'participated');
  const last = status.last;
  const updated =
    last && last.state !== 'running' && last.finished_at
      ? `最終更新 ${time(last.finished_at)}`
      : '';
  return (
    <Layout title="Events" user={user} active="opportunities">
      <PageHeading title="Events" description="作品と関心に合うイベントを自動で探して届けます。" />
      <nav class="tl-tabs ev-tabs" aria-label="イベントの表示">
        {(
          [
            ['foryou', 'For you', items.length],
            ['saved', '保存済み', saved.length],
            ['plans', '参加予定・参加済み', plans.length],
          ] as const
        ).map(([key, label, n]) => (
          <a href={`/opportunities?tab=${key}`} aria-current={tab === key ? 'page' : undefined}>
            {label}
            {n ? ` ${n}` : ''}
          </a>
        ))}
      </nav>
      {tab === 'foryou' ? (
        <section aria-label="For you">
          <p class="quiet ev-status" role="status">
            {!status.enabled
              ? 'AIの接続が設定されていないため、自動の探索は行っていません。保存済みのタブからURLで追加できます。'
              : status.running
                ? 'あなた向けのイベントを探しています。数分後に再読み込みしてください。'
                : `${updated ? updated + '。' : ''}次回は自動で更新されます。`}
          </p>
          {last?.state === 'failed' && !status.running && (
            <p class="quiet">前回の探索は完了しませんでした。次回の自動更新で再度探します。</p>
          )}
          {items.length ? (
            <div class="ev-grid">
              {items.map((s) => (
                <SuggestionCard s={s} />
              ))}
            </div>
          ) : status.enabled && (status.running || !last) ? (
            <div class="card ev-empty">
              <span class="loading loading-dots loading-md" aria-hidden="true" />
              <p>作品と関心から最初の候補を探しています。</p>
            </div>
          ) : (
            <p class="feed-empty">
              新しい候補はありません。作品や関心を更新すると次回の探索に反映されます。
            </p>
          )}
        </section>
      ) : tab === 'saved' ? (
        <section aria-label="保存済み">
          <SavedList
            items={saved}
            empty="保存したイベントはありません。For youから保存できます。"
          />
          <details class="card social-card ev-add">
            <summary>URLからイベントを追加する</summary>
            <form method="post" action="/opportunities" class="social-form">
              <OpportunityFields />
              <button class="btn btn-primary">保存</button>
            </form>
          </details>
        </section>
      ) : (
        <section aria-label="参加予定・参加済み">
          <SavedList
            items={plans}
            empty="参加予定のイベントはありません。保存したイベントの詳細で参加状況を変更できます。"
          />
        </section>
      )}
    </Layout>
  );
}
/** Small list for the Home right column. */
export function EventsRail({ items }: { items: Suggestion[] }) {
  return (
    <section class="card ev-rail" aria-label="あなた向けのイベント">
      <div class="ev-rail-head">
        <h2>Events</h2>
        <a href="/opportunities">すべて見る</a>
      </div>
      {items.length ? (
        <ul>
          {items.map((s) => (
            <li>
              <a href="/opportunities">{s.title}</a>
              <span class="quiet">
                {[short(s.date) || '日付未確認', s.source_domain].join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="quiet">新しい候補が届くとここに表示されます。</p>
      )}
    </section>
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
      <a class="ev-back" href="/opportunities?tab=saved">
        Eventsへ戻る
      </a>
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
                    <h3>次の作業</h3>
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
