import type { User, Profile } from './store';
import { Layout, Avatar } from './ui';

/** First-run guide: the three steps that turn coursework into a first published work. */
export function WelcomePage({
  user,
  profile,
  works,
  connected,
}: {
  user: User;
  profile: Profile;
  works: number;
  connected: boolean;
}) {
  const steps = [
    {
      done: profile.interests.length > 0 || profile.bio.length > 0,
      title: 'プロフィールと関心を設定',
      body: '関心のある分野をもとに、毎日あなた向けのイベントが届きます。',
      href: '/settings?tab=profile',
      label: 'プロフィールを設定',
    },
    {
      done: connected,
      title: 'エージェントを接続',
      body: 'Claude CodeなどにSkillとMCPを設定し、制作フォルダから下書きを作ります。',
      href: '/settings?tab=agent',
      label: 'エージェントを接続',
    },
    {
      done: works > 0,
      title: '下書きを確認して公開',
      body: '担当範囲と根拠を確認し、ページの見た目のまま整えてから公開します。',
      href: '/works?filter=agent',
      label: '下書きを確認',
    },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <Layout title="Welcome" user={user}>
      <section class="welcome">
        <div class="welcome-head">
          <Avatar name={user.display_name} asset={profile.avatar_asset_id} size="lg" />
          <div>
            <p class="quiet">@{user.handle}</p>
            <h1>Welcome</h1>
          </div>
        </div>
        <p class="lead">
          高専での制作を作品ページにまとめ、関心に合うイベントや仲間につなげます。次の3つで最初の作品を公開できます。
        </p>
        <ol class="welcome-steps">
          {steps.map((s, i) => (
            <li class={`card ${s.done ? 'is-done' : ''} ${i === next ? 'is-next' : ''}`}>
              <span class="step-index">{s.done ? '完了' : `0${i + 1}`}</span>
              <div>
                <h2>{s.title}</h2>
                <p class="quiet">{s.body}</p>
              </div>
              <a class={`btn btn-sm ${i === next ? 'btn-primary' : 'btn-outline'}`} href={s.href}>
                {s.label}
              </a>
            </li>
          ))}
        </ol>
        <a class="back-link" href="/home">
          あとで設定してHomeへ
        </a>
      </section>
    </Layout>
  );
}
