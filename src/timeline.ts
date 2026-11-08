import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError, type Published, type Store } from './store';
import { webUrl, type SocialStore } from './social';

const text = (max: number) => z.string().trim().min(1).max(max);
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const now = () => new Date().toISOString();
const hourAgo = () => new Date(Date.now() - 3600000).toISOString();

export const parseRoles = (input: unknown) =>
  [
    ...new Set(
      String(input ?? '')
        .split(/[,、\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
export const progressSchema = z
  .object({ body: text(280), work_id: z.string().trim().max(64).optional() })
  .strict();
export const recruitSchema = z
  .object({
    title: text(100),
    url: webUrl.optional(),
    roles: z.array(text(30)).min(1).max(8),
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => !Number.isNaN(Date.parse(v)))
      .optional(),
    body: text(1000),
  })
  .strict();
export const replySchema = text(500);
export const joinSchema = z
  .object({
    role: text(100),
    work_id: z.string().trim().max(64).optional(),
    message: text(500),
  })
  .strict();
export type RecruitData = { title: string; url?: string; roles: string[]; deadline?: string };
export type Post = {
  id: string;
  author_id: string;
  kind: 'progress' | 'recruit' | 'reply';
  parent_id: string | null;
  work_id: string | null;
  body: string;
  data: RecruitData;
  created_at: string;
  display_name: string;
  handle: string;
  likes: number;
  liked: boolean;
  replies: number;
  work: Published | null;
};
export type TimelineItem =
  { type: 'post'; at: string; post: Post } | { type: 'share'; at: string; work: Published };
export type Join = {
  id: string;
  post_id: string;
  applicant_id: string;
  owner_id: string;
  role: string;
  work_id: string | null;
  message: string;
  state: 'pending' | 'accepted' | 'declined' | 'cancelled';
  applicant_contact: string;
  owner_contact: string;
  created_at: string;
  applicant_name: string;
  applicant_handle: string;
  work: Published | null;
};

export class TimelineStore {
  constructor(
    public store: Store,
    public social: SocialStore,
  ) {}
  private published(workId: string | null, authorId: string): Published | null {
    if (!workId) return null;
    const row = this.store.db
      .query(
        'SELECT p.*,u.display_name,u.handle FROM publications p JOIN works w ON w.id=p.work_id JOIN users u ON u.id=w.owner_id WHERE p.work_id=? AND w.owner_id=?',
      )
      .get(workId, authorId) as (Omit<Published, 'data'> & { data: string }) | null;
    return row ? { ...row, data: JSON.parse(row.data) } : null;
  }
  private ownPublished(userId: string, workId: string | undefined) {
    if (!workId) return null;
    const work = this.published(workId, userId);
    if (!work) throw new DomainError(422, '添付できるのは自分が公開している作品だけです。');
    return work.work_id;
  }
  private rows(where: string, params: unknown[], viewer: string, limit = 200) {
    return (
      this.store.db
        .query(
          `SELECT t.*,u.display_name,u.handle,
            (SELECT count(*) FROM timeline_likes l WHERE l.post_id=t.id) AS likes,
            (SELECT count(*) FROM timeline_posts r WHERE r.parent_id=t.id) AS replies,
            EXISTS(SELECT 1 FROM timeline_likes l WHERE l.post_id=t.id AND l.user_id=?) AS liked
          FROM timeline_posts t JOIN users u ON u.id=t.author_id WHERE ${where} ORDER BY t.created_at DESC,t.rowid DESC LIMIT ${limit}`,
        )
        .all(viewer, ...(params as string[])) as (Omit<Post, 'data' | 'work' | 'liked'> & {
        data: string;
        liked: number;
      })[]
    )
      .filter(
        (r) =>
          !this.social.blocked(viewer, r.author_id) &&
          !this.store.db
            .query('SELECT 1 FROM timeline_reports WHERE reporter_id=? AND post_id=?')
            .get(viewer, r.id),
      )
      .map((r): Post => ({
        ...r,
        liked: !!r.liked,
        data: JSON.parse(r.data),
        work: this.published(r.work_id, r.author_id),
      }));
  }
  private limit(userId: string, kinds: string[], max: number, message: string, since = hourAgo()) {
    const n = (
      this.store.db
        .query(
          `SELECT count(*) AS n FROM timeline_posts WHERE author_id=? AND kind IN (${kinds.map(() => '?').join(',')}) AND created_at>?`,
        )
        .get(userId, ...kinds, since) as { n: number }
    ).n;
    if (n >= max) throw new DomainError(429, message);
  }
  private insert(userId: string, kind: string, body: string, workId: string | null, data: object) {
    const id = randomUUID();
    this.store.db
      .query(
        'INSERT INTO timeline_posts(id,author_id,kind,work_id,body,data,created_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(id, userId, kind, workId, body, JSON.stringify(data), now());
    return id;
  }
  progress(userId: string, input: unknown) {
    const data = progressSchema.parse(input);
    this.limit(
      userId,
      ['progress', 'recruit'],
      30,
      '投稿の回数が多くなっています。1時間後に試してください。',
    );
    return this.insert(
      userId,
      'progress',
      data.body,
      this.ownPublished(userId, data.work_id || undefined),
      {},
    );
  }
  recruit(userId: string, input: unknown) {
    const data = recruitSchema.parse(input);
    if (data.deadline && data.deadline < today())
      throw new DomainError(422, '締切は今日以降の日付にしてください。');
    this.limit(
      userId,
      ['progress', 'recruit'],
      30,
      '投稿の回数が多くなっています。1時間後に試してください。',
    );
    const { body, ...rest } = data;
    return this.insert(userId, 'recruit', body, null, rest);
  }
  post(id: string, viewer: string): Post {
    const post = this.rows('t.id=?', [id], viewer, 1)[0];
    if (!post) throw new DomainError(404, '投稿が見つかりません。ホームを確認してください。');
    return post;
  }
  feed(viewer: string, filter: 'all' | 'recruit', role?: string): TimelineItem[] {
    const posts = this.rows(
      filter === 'recruit' || role ? "t.kind='recruit'" : "t.kind IN ('progress','recruit')",
      [],
      viewer,
    ).filter((p) => !role || p.data.roles.includes(role));
    const items: TimelineItem[] = posts.map((post) => ({
      type: 'post',
      at: post.created_at,
      post,
    }));
    if (filter === 'all' && !role)
      for (const work of this.store
        .published()
        .filter((w) => !this.social.blocked(viewer, this.owner(w.work_id))))
        items.push({ type: 'share', at: work.published_at, work });
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
  }
  private owner(workId: string) {
    return (
      this.store.db.query('SELECT owner_id FROM works WHERE id=?').get(workId) as {
        owner_id: string;
      }
    ).owner_id;
  }
  roles(viewer: string) {
    const counts = new Map<string, number>();
    for (const p of this.rows("t.kind='recruit'", [], viewer, 100))
      if (!p.data.deadline || p.data.deadline >= today())
        for (const r of p.data.roles) counts.set(r, (counts.get(r) ?? 0) + 1);
    return [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([r]) => r);
  }
  replies(postId: string, viewer: string) {
    return this.rows('t.parent_id=?', [postId], viewer, 100).reverse();
  }
  reply(userId: string, postId: string, input: unknown) {
    const post = this.post(postId, userId),
      body = replySchema.parse(input);
    if (post.kind === 'reply')
      throw new DomainError(422, '返信への返信はできません。投稿に返信してください。');
    this.limit(userId, ['reply'], 60, '返信の回数が多くなっています。1時間後に試してください。');
    const id = randomUUID();
    this.store.db.transaction(() => {
      this.store.db
        .query(
          "INSERT INTO timeline_posts(id,author_id,kind,parent_id,body,created_at) VALUES(?,?,'reply',?,?,?)",
        )
        .run(id, userId, postId, body, now());
      this.social.timelineNotice(
        post.author_id,
        userId,
        postId,
        `${this.store.user(userId).display_name}さんから投稿への返信が届きました。`,
        `/timeline/${postId}#replies`,
      );
    })();
    return id;
  }
  like(userId: string, postId: string) {
    const post = this.post(postId, userId);
    if (post.kind === 'reply') throw new DomainError(404, '投稿が見つかりません。');
    const had = this.store.db
      .query('SELECT 1 FROM timeline_likes WHERE user_id=? AND post_id=?')
      .get(userId, postId);
    if (had)
      this.store.db
        .query('DELETE FROM timeline_likes WHERE user_id=? AND post_id=?')
        .run(userId, postId);
    else this.store.db.query('INSERT INTO timeline_likes VALUES(?,?)').run(userId, postId);
  }
  remove(userId: string, id: string) {
    const row = this.store.db.query('SELECT * FROM timeline_posts WHERE id=?').get(id) as {
      author_id: string;
      parent_id: string | null;
    } | null;
    if (!row) throw new DomainError(404, '投稿が見つかりません。');
    const parent = row.parent_id
      ? (this.store.db
          .query('SELECT author_id FROM timeline_posts WHERE id=?')
          .get(row.parent_id) as { author_id: string } | null)
      : null;
    if (row.author_id !== userId && parent?.author_id !== userId)
      throw new DomainError(403, 'この投稿は削除できません。');
    const db = this.store.db;
    db.transaction(() => {
      const ids = [
        id,
        ...(
          db.query('SELECT id FROM timeline_posts WHERE parent_id=?').all(id) as { id: string }[]
        ).map((r) => r.id),
      ];
      for (const x of ids) {
        db.query('DELETE FROM timeline_likes WHERE post_id=?').run(x);
        db.query('DELETE FROM timeline_notices WHERE post_id=?').run(x);
        db.query('DELETE FROM timeline_joins WHERE post_id=?').run(x);
        db.query('DELETE FROM timeline_posts WHERE id=?').run(x);
      }
    })();
    return row.parent_id;
  }
  report(userId: string, id: string, reason: string) {
    this.post(id, userId);
    this.store.db
      .query(
        'INSERT INTO timeline_reports VALUES(?,?,?,?,?) ON CONFLICT(reporter_id,post_id) DO UPDATE SET reason=excluded.reason',
      )
      .run(randomUUID(), userId, id, text(1000).parse(reason), now());
  }
  join(userId: string, postId: string, input: unknown) {
    const post = this.post(postId, userId),
      data = joinSchema.parse(input);
    if (post.kind !== 'recruit') throw new DomainError(422, '参加希望は仲間募集に送ってください。');
    if (post.author_id === userId)
      throw new DomainError(422, '自分の募集には参加希望を送れません。');
    if (post.data.deadline && post.data.deadline < today())
      throw new DomainError(409, 'この募集は締切を過ぎています。');
    if (
      this.store.db
        .query(
          "SELECT 1 FROM timeline_joins WHERE post_id=? AND applicant_id=? AND state IN ('pending','accepted')",
        )
        .get(postId, userId)
    )
      throw new DomainError(
        409,
        'この募集へはすでに参加希望を送っています。投稿の詳細で確認してください。',
      );
    const count = this.store.db
      .query('SELECT count(*) AS n FROM timeline_joins WHERE applicant_id=? AND created_at>?')
      .get(userId, new Date(Date.now() - 86400000).toISOString()) as { n: number };
    if (count.n >= 10)
      throw new DomainError(429, '参加希望の送信上限に達しました。翌日に試してください。');
    const work = this.ownPublished(userId, data.work_id || undefined),
      id = randomUUID();
    this.store.db.transaction(() => {
      this.store.db
        .query(
          'INSERT INTO timeline_joins(id,post_id,applicant_id,owner_id,role,work_id,message,created_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(id, postId, userId, post.author_id, data.role, work, data.message, now());
      this.social.timelineNotice(
        post.author_id,
        userId,
        postId,
        `${this.store.user(userId).display_name}さんから参加希望が届きました。`,
        `/timeline/${postId}#joins`,
      );
    })();
    return id;
  }
  joins(postId: string, viewer: string): Join[] {
    const rows = this.store.db
      .query(
        'SELECT j.*,u.display_name AS applicant_name,u.handle AS applicant_handle FROM timeline_joins j JOIN users u ON u.id=j.applicant_id WHERE j.post_id=? AND (j.applicant_id=? OR j.owner_id=?) ORDER BY j.created_at',
      )
      .all(postId, viewer, viewer) as Join[];
    return rows
      .filter((j) => !this.social.blocked(j.applicant_id, j.owner_id))
      .map((j) => ({
        ...j,
        applicant_contact: j.state === 'accepted' ? j.applicant_contact : '',
        owner_contact: j.state === 'accepted' ? j.owner_contact : '',
        work: this.published(j.work_id, j.applicant_id),
      }));
  }
  private joinOf(userId: string, id: string) {
    const row = this.store.db.query('SELECT post_id FROM timeline_joins WHERE id=?').get(id) as {
      post_id: string;
    } | null;
    const item = row && this.joins(row.post_id, userId).find((j) => j.id === id);
    if (!item)
      throw new DomainError(404, '参加希望が見つかりません。投稿の詳細を確認してください。');
    return item;
  }
  decide(userId: string, id: string, state: 'accepted' | 'declined' | 'cancelled') {
    const item = this.joinOf(userId, id);
    if ((state === 'cancelled' ? item.applicant_id : item.owner_id) !== userId)
      throw new DomainError(403, 'この参加希望は操作できません。');
    if (item.state !== 'pending')
      throw new DomainError(409, '返事の状態が変わっています。投稿の詳細を読み直してください。');
    this.store.db.transaction(() => {
      this.store.db.query('UPDATE timeline_joins SET state=? WHERE id=?').run(state, id);
      this.social.timelineNotice(
        userId === item.owner_id ? item.applicant_id : item.owner_id,
        userId,
        item.post_id,
        state === 'accepted'
          ? '参加希望が受け入れられました。連絡先を共有して相談できます。'
          : state === 'declined'
            ? '参加希望が見送られました。'
            : '参加希望が取り消されました。',
        `/timeline/${item.post_id}#joins`,
      );
    })();
    return item.post_id;
  }
  contact(userId: string, id: string, input: string) {
    const item = this.joinOf(userId, id);
    if (item.state !== 'accepted')
      throw new DomainError(409, '参加希望が受け入れられた後に連絡先を共有できます。');
    const value = input.trim() === '' ? '' : webUrl.parse(input);
    const column = item.applicant_id === userId ? 'applicant_contact' : 'owner_contact';
    this.store.db.query(`UPDATE timeline_joins SET ${column}=? WHERE id=?`).run(value, id);
    return item.post_id;
  }
}
