import type { Work } from './store';
import type { Invitation } from './social';
import type { Join } from './timeline';
import type { Suggestion } from './opportunities';
import { Avatar } from './ui';

const short = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}` : '';

/** The top of Home: the one event worth acting on, answers people are waiting for, and drafts. */
export function NextSection({
  event,
  joins,
  invitations,
  drafts,
  proposals,
}: {
  event?: Suggestion;
  joins: (Join & { post_title: string })[];
  invitations: Invitation[];
  drafts: Work[];
  proposals: Record<string, number>;
}) {
  const waiting = joins.length + invitations.length;
  return (
    <section class="next" aria-label="次にやること">
      <article class="card next-event">
        <p class="next-label">あなた向けのイベント</p>
        {event ? (
          <>
            <h2>
              <a href="/opportunities">{event.title}</a>
            </h2>
            <p class="next-meta">
              {[
                event.date && `開催 ${short(event.date)}`,
                event.deadline && `締切 ${short(event.deadline)}`,
                event.location,
                event.source_domain,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p class="next-reason">{event.reason}</p>
            <p class="next-role">
              <span>できる役割</span>
              {event.role}
            </p>
            <div class="next-actions">
              <form method="post" action={`/opportunities/suggestions/${event.id}/save`}>
                <button class="btn btn-primary btn-sm">保存して準備する</button>
              </form>
              <a class="btn btn-outline btn-sm" href="/opportunities">
                ほかの候補
              </a>
            </div>
          </>
        ) : (
          <>
            <h2>候補を探しています</h2>
            <p class="quiet">
              作品と関心をもとに自動で探します。プロフィールの関心を設定すると精度が上がります。
            </p>
            <a class="btn btn-outline btn-sm" href="/settings?tab=profile">
              関心を設定
            </a>
          </>
        )}
      </article>
      <div class="next-side">
        <section class="card next-box">
          <div class="next-box-head">
            <h2>返事を待っています</h2>
            <span class="count">{waiting}</span>
          </div>
          {waiting ? (
            <ul>
              {joins.slice(0, 3).map((j) => (
                <li>
                  <Avatar name={j.applicant_name} asset={j.applicant_avatar} size="sm" />
                  <div>
                    <p>
                      <strong>{j.applicant_name}</strong>が「{j.post_title}」に{j.role}で参加希望
                    </p>
                    <div class="next-inline">
                      <form method="post" action={`/timeline/joins/${j.id}/state`}>
                        <input type="hidden" name="state" value="accepted" />
                        <input type="hidden" name="back" value="/home" />
                        <button class="btn btn-primary btn-xs">受け入れる</button>
                      </form>
                      <a class="btn btn-ghost btn-xs" href="/connections">
                        詳細
                      </a>
                    </div>
                  </div>
                </li>
              ))}
              {invitations.slice(0, 3).map((i) => (
                <li>
                  <Avatar name={i.sender_name} size="sm" />
                  <div>
                    <p>
                      <strong>{i.sender_name}</strong>から「{i.event_title}」への誘い（
                      {i.recipient_role}）
                    </p>
                    <div class="next-inline">
                      <form method="post" action={`/social/invitations/${i.id}/state`}>
                        <input type="hidden" name="state" value="accepted" />
                        <input type="hidden" name="back" value="/home" />
                        <button class="btn btn-primary btn-xs">受け入れる</button>
                      </form>
                      <a class="btn btn-ghost btn-xs" href="/connections">
                        詳細
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p class="quiet">新しい参加希望や誘いはありません。</p>
          )}
        </section>
        <section class="card next-box">
          <div class="next-box-head">
            <h2>確認待ちの下書き</h2>
            <span class="count">{drafts.length}</span>
          </div>
          {drafts.length ? (
            <ul>
              {drafts.slice(0, 3).map((w) => (
                <li>
                  <div>
                    <a href={`/works/${w.id}`}>{w.data.title}</a>
                    <p class="quiet">
                      {proposals[w.id] ? `更新案 ${proposals[w.id]} 件` : 'エージェントの下書き'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <a class="btn btn-outline btn-sm" href="/settings?tab=agent">
              エージェントで作品を追加
            </a>
          )}
        </section>
      </div>
    </section>
  );
}
