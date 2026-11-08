import type { Profile, Published, User } from './store';
import type { TimelineStore } from './timeline';
import { Avatar, Layout, PublicPortfolio } from './ui';
import { FeedList, Icon } from './timeline-ui';

export type ProfileTab = 'works' | 'posts';

/** X-style public profile: banner, identity, then Works and Posts tabs. */
export function ProfilePage({
  person,
  profile,
  viewer,
  works,
  timeline,
  tab,
  year,
  tag,
}: {
  person: { id: string; display_name: string; handle: string };
  profile: Profile;
  viewer?: User;
  works: Published[];
  timeline: TimelineStore;
  tab: ProfileTab;
  year?: string;
  tag?: string;
}) {
  const own = viewer?.id === person.id;
  const items = tab === 'posts' ? timeline.byAuthor(person.id, viewer?.id ?? '') : [];
  const base = `/u/${person.handle}`;
  return (
    <Layout
      title={person.display_name}
      user={viewer}
      portfolio={!viewer}
      active={own ? 'profile' : undefined}
    >
      <div class="x-profile">
        <div class="x-banner" aria-hidden="true" />
        <header class="x-profile-head">
          <Avatar name={person.display_name} asset={profile.avatar_asset_id} size="xl" />
          <div class="x-profile-actions">
            {own ? (
              <a class="btn btn-sm x-btn" href="/settings">
                プロフィールを編集
              </a>
            ) : viewer ? (
              <a class="btn btn-sm x-btn" href={`/connections?with=${person.handle}`}>
                メッセージ
              </a>
            ) : null}
          </div>
        </header>
        <div class="x-profile-body">
          <h1>{person.display_name}</h1>
          <p class="x-handle">@{person.handle}</p>
          {profile.bio && <p class="x-bio preserve-lines">{profile.bio}</p>}
          {!!profile.interests.length && (
            <div class="x-chips" aria-label="関心">
              {profile.interests.map((t) => (
                <span class="x-chip">{t}</span>
              ))}
            </div>
          )}
          {!!profile.links.length && (
            <ul class="x-profile-links">
              {profile.links.map((l) => (
                <li>
                  <a class="x-link" href={l.url} target="_blank" rel="noopener noreferrer me">
                    <Icon name="link" />
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p class="x-profile-stats">
            <span>
              <strong>{works.length}</strong> 件の公開作品
            </span>
          </p>
        </div>
        <nav class="x-tabs x-profile-tabs" aria-label="プロフィールの表示">
          <a href={base} aria-current={tab === 'works' ? 'page' : undefined}>
            Works
          </a>
          <a href={`${base}?tab=posts`} aria-current={tab === 'posts' ? 'page' : undefined}>
            Posts
          </a>
        </nav>
        {tab === 'works' ? (
          <PublicPortfolio works={works} year={year} tag={tag} />
        ) : items.length ? (
          <div class="x-profile-posts">
            <FeedList items={items} user={viewer} back={`${base}?tab=posts`} timeline={timeline} />
          </div>
        ) : (
          <div class="x-list x-empty">
            <h3>投稿はありません</h3>
            <p>進捗や仲間募集を投稿すると、ここに表示されます。</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
