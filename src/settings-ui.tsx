import type { Profile, Store, User } from './store';
import { Avatar, ConnectPage, Field, Layout, PageHeading } from './ui';

export type SettingsTab = 'profile' | 'agent' | 'account';
const tabs: [SettingsTab, string, string][] = [
  ['profile', 'Profile', 'アイコンと自己紹介'],
  ['agent', 'Agent', 'エージェントの接続'],
  ['account', 'Account', 'メールとログアウト'],
];

function ProfileForm({ user, profile }: { user: User; profile: Profile }) {
  const links = [...profile.links, ...Array(6).fill({ label: '', url: '' })].slice(0, 6) as {
    label: string;
    url: string;
  }[];
  return (
    <form
      class="x-settings-form"
      method="post"
      action="/settings/profile"
      enctype="multipart/form-data"
    >
      <section class="card x-settings-card">
        <h2>アイコン</h2>
        <div class="x-avatar-field">
          <Avatar name={user.display_name} asset={profile.avatar_asset_id} size="lg" />
          <div>
            <label class="field">
              <span>画像を選ぶ</span>
              <input
                class="file-input file-input-sm"
                type="file"
                name="avatar"
                accept="image/png,image/jpeg,image/webp"
              />
              <small>5MB以内のPNG・JPEG・WebPを選んでください。</small>
            </label>
            {profile.avatar_asset_id && (
              <label class="check-field">
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  name="remove_avatar"
                  value="yes"
                />
                アイコンを削除する
              </label>
            )}
          </div>
        </div>
      </section>
      <section class="card x-settings-card">
        <h2>基本情報</h2>
        <Field
          label="表示名"
          name="display_name"
          value={user.display_name}
          required
          maxLength={60}
        />
        <label class="field">
          <span>自己紹介</span>
          <textarea class="textarea" name="bio" rows={4} maxLength={300}>
            {profile.bio}
          </textarea>
          <small>300字まで入力できます。</small>
        </label>
        <Field
          label="関心（読点か改行で区切り）"
          name="interests"
          value={profile.interests.join('、')}
          maxLength={800}
          placeholder="電子工作、UI設計、ハッカソン"
          help="16個まで登録できます。プロフィールにタグとして表示されます。"
        />
        {!!profile.interests.length && (
          <div class="x-chips">
            {profile.interests.map((t) => (
              <span class="x-chip">{t}</span>
            ))}
          </div>
        )}
      </section>
      <section class="card x-settings-card">
        <h2>リンク</h2>
        <p class="quiet">GitHubやポートフォリオなど6件まで登録できます。</p>
        <div class="x-link-rows">
          {links.map((l, i) => (
            <div class="field-pair">
              <Field
                label={`表示名 ${i + 1}`}
                name={`link_label_${i}`}
                value={l.label}
                maxLength={40}
              />
              <Field
                label={`URL ${i + 1}`}
                name={`link_url_${i}`}
                type="url"
                value={l.url}
                maxLength={300}
                placeholder="https://"
              />
            </div>
          ))}
        </div>
      </section>
      <div class="x-settings-submit">
        <a class="btn btn-sm x-btn" href={`/u/${user.handle}`}>
          プロフィールを見る
        </a>
        <button class="btn btn-primary">保存</button>
      </div>
    </form>
  );
}
function Account({ user }: { user: User }) {
  return (
    <section class="card x-settings-card">
      <h2>アカウント</h2>
      <dl class="x-account">
        <dt>メールアドレス</dt>
        <dd>{user.email}</dd>
        <dt>公開ID</dt>
        <dd>@{user.handle}</dd>
        <dt>公開ページ</dt>
        <dd>
          <a class="x-link" href={`/u/${user.handle}`}>
            /u/{user.handle}
          </a>
        </dd>
      </dl>
      <form method="post" action="/logout">
        <button class="btn btn-sm x-btn x-danger">ログアウト</button>
      </form>
    </section>
  );
}
export function SettingsPage({
  user,
  tab,
  profile,
  tokens,
  origin,
  issued,
  notice,
}: {
  user: User;
  tab: SettingsTab;
  profile: Profile;
  tokens: ReturnType<Store['tokens']>;
  origin: string;
  issued?: { token: string; expires: number };
  notice?: string;
}) {
  return (
    <Layout title="Settings" user={user} active="settings">
      <PageHeading title="Settings" />
      <div class="x-settings">
        <nav class="x-settings-nav" aria-label="設定の項目">
          {tabs.map(([key, label, help]) => (
            <a
              href={key === 'profile' ? '/settings' : `/settings?tab=${key}`}
              aria-current={tab === key ? 'page' : undefined}
            >
              <strong>{label}</strong>
              <span>{help}</span>
            </a>
          ))}
        </nav>
        <div class="x-settings-main">
          {notice && (
            <p role="status" class="alert">
              {notice}
            </p>
          )}
          {tab === 'profile' ? (
            <ProfileForm user={user} profile={profile} />
          ) : tab === 'agent' ? (
            <ConnectPage tokens={tokens} origin={origin} issued={issued} />
          ) : (
            <Account user={user} />
          )}
        </div>
      </div>
    </Layout>
  );
}
