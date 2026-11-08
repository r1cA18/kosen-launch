import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError, type Published, type Store } from './store';
import { webUrl, type Invitation, type SocialStore } from './social';

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
  avatar: string | null;
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
  applicant_avatar: string | null;
  work: Published | null;
};
export type Person = { id: string; display_name: string; handle: string; avatar: string | null };
/** One entry of a direct conversation, built from questions, invitations and joins. */
export type Message = { at: string; order: number; from: string } & (
  | {
      type: 'question' | 'answer';
      question_id: string;
      body: string;
      work_title: string;
      work_href: string;
    }
  | { type: 'invitation'; invitation: Invitation }
  | { type: 'join'; join: Join; post_title: string }
  | { type: 'direct'; body: string }
);
export type ConversationSummary = {
  person: Person;
  last: Message;
  unread: boolean;
  count: number;
};

const byTime = (a: Message, b: Message) => a.at.localeCompare(b.at) || a.order - b.order;

export class TimelineStore {
  constructor(
    public store: Store,
    public social: SocialStore,
  ) {
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS direct_messages(id TEXT PRIMARY KEY,sender_id TEXT NOT NULL REFERENCES users(id),recipient_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS direct_messages_pair ON direct_messages(sender_id,recipient_id)',
    );
  }
  /** Private messages open only after one side accepted the other's invitation or join request. */
  connected(a: string, b: string) {
    if (a === b || this.social.blocked(a, b)) return false;
    return !!(
      this.store.db
        .query(
          "SELECT 1 FROM social_invitations WHERE state='accepted' AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))",
        )
        .get(a, b, b, a) ||
      this.store.db
        .query(
          "SELECT 1 FROM timeline_joins WHERE state='accepted' AND ((applicant_id=? AND owner_id=?) OR (applicant_id=? AND owner_id=?))",
        )
        .get(a, b, b, a)
    );
  }
  sendDirect(userId: string, otherId: string, input: unknown) {
    const body = z.string().trim().min(1).max(2000).parse(input);
    if (!this.connected(userId, otherId))
      throw new DomainError(403, '誘いか参加希望を受け入れた相手にだけメッセージを送れます。');
    const recent = this.store.db
      .query('SELECT count(*) n FROM direct_messages WHERE sender_id=? AND created_at>?')
      .get(userId, new Date(Date.now() - 3600_000).toISOString()) as { n: number };
    if (recent.n >= 120)
      throw new DomainError(429, 'メッセージの回数が多くなっています。1時間後に試してください。');
    this.store.db
      .query('INSERT INTO direct_messages VALUES(?,?,?,?,?)')
      .run(randomUUID(), userId, otherId, body, new Date().toISOString());
    const sender = this.store.user(userId);
    this.social.timelineNotice(
      otherId,
      userId,
      'direct',
      `${sender.display_name}さんからメッセージが届きました。`,
      `/connections?with=${sender.handle}`,
    );
  }
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
          `SELECT t.*,u.display_name,u.handle,pr.avatar_asset_id AS avatar,
            (SELECT count(*) FROM timeline_likes l WHERE l.post_id=t.id) AS likes,
            (SELECT count(*) FROM timeline_posts r WHERE r.parent_id=t.id) AS replies,
            EXISTS(SELECT 1 FROM timeline_likes l WHERE l.post_id=t.id AND l.user_id=?) AS liked
          FROM timeline_posts t JOIN users u ON u.id=t.author_id LEFT JOIN profiles pr ON pr.user_id=t.author_id WHERE ${where} ORDER BY t.created_at DESC,t.rowid DESC LIMIT ${limit}`,
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
  /** Posts shown on a profile. An empty viewer is an anonymous visitor. */
  byAuthor(authorId: string, viewer: string): TimelineItem[] {
    if (viewer && this.social.blocked(viewer, authorId)) return [];
    const items: TimelineItem[] = this.rows(
      "t.author_id=? AND t.kind IN ('progress','recruit')",
      [authorId],
      viewer,
      80,
    ).map((post) => ({ type: 'post', at: post.created_at, post }));
    const handle = this.store.user(authorId).handle;
    for (const work of this.store.published(handle).filter((w) => w.share_to_feed))
      items.push({ type: 'share', at: work.published_at, work });
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
  }
  person(userId: string): Person {
    const u = this.store.user(userId);
    return {
      id: u.id,
      display_name: u.display_name,
      handle: u.handle,
      avatar: this.store.avatarOf(u.id),
    };
  }
  /** Every message between the viewer and other people, grouped by the other person. */
  private messages(viewer: string) {
    const out: (Message & { other: string })[] = [];
    const questions = this.store.db
      .query(
        `SELECT q.id,q.work_id,q.author_id,q.body,q.answer,q.created_at,w.owner_id,u.handle AS owner_handle,p.data
        FROM social_questions q JOIN works w ON w.id=q.work_id JOIN users u ON u.id=w.owner_id
        JOIN publications p ON p.work_id=q.work_id AND p.share_to_feed=1
        WHERE (q.author_id=? OR w.owner_id=?) AND q.author_id<>w.owner_id
        AND NOT EXISTS(SELECT 1 FROM social_reports r WHERE r.reporter_id=? AND r.question_id=q.id)
        ORDER BY q.created_at DESC LIMIT 300`,
      )
      .all(viewer, viewer, viewer) as {
      id: string;
      work_id: string;
      author_id: string;
      body: string;
      answer: string;
      created_at: string;
      owner_id: string;
      owner_handle: string;
      data: string;
    }[];
    for (const q of questions) {
      const other = q.author_id === viewer ? q.owner_id : q.author_id;
      if (this.social.blocked(viewer, other)) continue;
      const base = {
        question_id: q.id,
        work_title: JSON.parse(q.data).title as string,
        work_href: `/u/${q.owner_handle}/works/${q.work_id}#conversation`,
        at: q.created_at,
        other,
      };
      out.push({ ...base, type: 'question', order: 0, from: q.author_id, body: q.body });
      if (q.answer)
        out.push({ ...base, type: 'answer', order: 1, from: q.owner_id, body: q.answer });
    }
    const directs = this.store.db
      .query(
        'SELECT sender_id,recipient_id,body,created_at FROM direct_messages WHERE sender_id=? OR recipient_id=? ORDER BY created_at DESC LIMIT 500',
      )
      .all(viewer, viewer) as {
      sender_id: string;
      recipient_id: string;
      body: string;
      created_at: string;
    }[];
    for (const d of directs) {
      const other = d.sender_id === viewer ? d.recipient_id : d.sender_id;
      if (this.social.blocked(viewer, other)) continue;
      out.push({
        type: 'direct',
        body: d.body,
        at: d.created_at,
        order: 2,
        from: d.sender_id,
        other,
      });
    }
    for (const invitation of this.social.invitations(viewer))
      out.push({
        type: 'invitation',
        invitation,
        at: invitation.created_at,
        order: 0,
        from: invitation.sender_id,
        other: invitation.sender_id === viewer ? invitation.recipient_id : invitation.sender_id,
      });
    const posts = this.store.db
      .query(
        `SELECT DISTINCT j.post_id,t.data FROM timeline_joins j JOIN timeline_posts t ON t.id=j.post_id
        WHERE j.applicant_id=? OR j.owner_id=? LIMIT 200`,
      )
      .all(viewer, viewer) as { post_id: string; data: string }[];
    for (const p of posts)
      for (const join of this.joins(p.post_id, viewer))
        out.push({
          type: 'join',
          join,
          post_title: JSON.parse(p.data).title ?? '仲間募集',
          at: join.created_at,
          order: 0,
          from: join.applicant_id,
          other: join.applicant_id === viewer ? join.owner_id : join.applicant_id,
        });
    return out.filter((m) => m.other !== viewer);
  }
  conversations(viewer: string): ConversationSummary[] {
    const unread = new Set(
      this.social
        .notices(viewer)
        .filter((n) => !n.read)
        .map((n) => n.actor_id),
    );
    const groups = new Map<string, Message[]>();
    for (const m of this.messages(viewer)) groups.set(m.other, [...(groups.get(m.other) ?? []), m]);
    return [...groups]
      .map(([other, list]) => ({
        person: this.person(other),
        last: list.sort(byTime).at(-1)!,
        unread: unread.has(other),
        count: list.length,
      }))
      .sort((a, b) => byTime(b.last, a.last));
  }
  thread(viewer: string, other: string): Message[] {
    return this.messages(viewer)
      .filter((m) => m.other === other)
      .sort(byTime);
  }
  /** The newest question from `other` on the viewer's works that still has no answer. */
  openQuestion(viewer: string, other: string) {
    const thread = this.thread(viewer, other);
    const answered = new Set(thread.flatMap((m) => (m.type === 'answer' ? [m.question_id] : [])));
    return thread
      .flatMap((m) =>
        m.type === 'question' && m.from === other && !answered.has(m.question_id) ? [m] : [],
      )
      .at(-1);
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
        'SELECT j.*,u.display_name AS applicant_name,u.handle AS applicant_handle,pr.avatar_asset_id AS applicant_avatar FROM timeline_joins j JOIN users u ON u.id=j.applicant_id LEFT JOIN profiles pr ON pr.user_id=j.applicant_id WHERE j.post_id=? AND (j.applicant_id=? OR j.owner_id=?) ORDER BY j.created_at',
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
  /** Join requests waiting for this user's answer, newest first, with the recruit title. */
  pendingJoins(ownerId: string) {
    const rows = this.store.db
      .query(
        "SELECT DISTINCT post_id FROM timeline_joins WHERE owner_id=? AND state='pending' ORDER BY created_at DESC LIMIT 10",
      )
      .all(ownerId) as { post_id: string }[];
    return rows.flatMap(({ post_id }) => {
      const title = this.post(post_id, ownerId).data.title ?? '';
      return this.joins(post_id, ownerId)
        .filter((j) => j.state === 'pending' && j.owner_id === ownerId)
        .map((j) => ({ ...j, post_title: title }));
    });
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
