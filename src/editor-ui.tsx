import { raw } from 'hono/html';
import type { User, Work, Store, Proposal } from './store';
import { kindLabels, statusLabels } from './schema';
import { fieldTitles, layoutOf } from './layout';
import { Layout, WorkDetail } from './ui';

/** JSON for the client editor; `<` is escaped so the payload cannot close the script tag. */
const json = (value: unknown) => raw(JSON.stringify(value).replace(/</g, '\\u003c'));

export function EditorPage({
  user,
  work,
  store,
  proposals,
}: {
  user: User;
  work: Work;
  store: Store;
  proposals: Proposal[];
}) {
  const data = { ...work.data, layout: layoutOf(work.data) };
  const assets = Object.fromEntries(
    data.asset_ids.map((id) => [id, { url: `/assets/${id}`, alt: store.asset(id, user.id).alt }]),
  );
  const a = work.data.assessment;
  return (
    <Layout title={`${work.data.title}の編集`} user={user} active="works">
      <div class="editor-shell" data-editor data-work={work.id} data-revision={work.revision}>
        <div class="editor-bar glass">
          <a class="back-link" href="/works">
            Works
          </a>
          <span class={`status-pill ${work.published_revision ? 'is-live' : ''}`}>
            {work.published_revision ? '公開中' : '下書き'}
          </span>
          <span class="quiet" data-save-state>
            保存済み
          </span>
          <span class="editor-bar-actions">
            <button class="btn btn-sm btn-outline" type="button" data-notes-toggle>
              根拠と確認事項
            </button>
            <a class="btn btn-sm btn-outline" href={`/works/${work.id}/preview`} data-preview>
              全画面プレビュー
            </a>
            <button class="btn btn-sm btn-primary" type="button" data-save>
              保存
            </button>
            <a class="btn btn-sm btn-outline" href={`/works/${work.id}/review`} data-review>
              公開へ進む
            </a>
          </span>
        </div>
        {proposals.map((p) => (
          <section class="card proposal">
            <h2>エージェントから更新案が届いています</h2>
            <p class="quiet">元の版：{p.base_revision}。採用すると下書きが更新されます。</p>
            <details>
              <summary>現在の内容と更新案を比較する</summary>
              <div class="comparison">
                <div>
                  <h3>現在</h3>
                  <WorkDetail data={work.data} store={store} userId={user.id} />
                </div>
                <div>
                  <h3>更新案</h3>
                  <WorkDetail data={p.data} store={store} userId={user.id} />
                </div>
              </div>
            </details>
            <div class="actions">
              <form method="post" action={`/proposals/${p.id}/accept`}>
                <button class="btn btn-primary btn-sm">更新案を採用</button>
              </form>
              <form method="post" action={`/proposals/${p.id}/dismiss`}>
                <button class="btn btn-outline btn-sm">見送る</button>
              </form>
            </div>
          </section>
        ))}
        <noscript>
          <p class="alert alert-warning">
            ブロック編集にはJavaScriptが必要です。
            <a href={`/works/${work.id}/form`}>入力フォームで編集</a>できます。
          </p>
        </noscript>
        <div class="editor-page public-work" data-canvas />
        <aside class="editor-notes card" data-notes hidden>
          <h2>根拠と確認事項（非公開）</h2>
          <p class="quiet">
            {a?.basis === 'documented'
              ? '資料に担当の記載があります。'
              : a?.basis === 'inferred'
                ? '担当は資料からの推定です。'
                : a?.basis === 'unknown'
                  ? '本人の担当を確定できていません。'
                  : '担当の判断記録はありません。'}
          </p>
          {a?.evidence && <p>{a.evidence}</p>}
          {a && a.uncertainties.length > 0 && (
            <>
              <h3>確認事項</h3>
              <ul>
                {a.uncertainties.map((u) => (
                  <li>{u}</li>
                ))}
              </ul>
            </>
          )}
          {work.data.sources.length > 0 && (
            <>
              <h3>根拠のメモ</h3>
              <ul>
                {work.data.sources.map((s) => (
                  <li>
                    <strong>{s.label}</strong>
                    <br />
                    {s.note}
                  </li>
                ))}
              </ul>
            </>
          )}
          <a class="btn btn-sm btn-ghost" href={`/works/${work.id}/form`}>
            入力フォームで編集
          </a>
        </aside>
        <script type="application/json" id="editor-data">
          {json({
            data,
            assets,
            kinds: kindLabels,
            statuses: statusLabels,
            fields: fieldTitles,
          })}
        </script>
      </div>
      <script src="/editor.js" defer />
    </Layout>
  );
}
