import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store, DomainError } from './store';

const text = (max: number) => z.string().trim().min(1).max(max);
export const webUrl = z
  .url()
  .max(1500)
  .refine((value) => {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  }, 'HTTPまたはHTTPSのURLを入力してください。');
export const invitationSchema = z
  .object({
    event_title: text(150),
    event_url: webUrl,
    purpose: text(1000),
    sender_role: text(200),
    recipient_role: text(200),
    next_step: text(500),
  })
  .strict();
export type InvitationInput = z.infer<typeof invitationSchema>;
export type Question = {
  id: string;
  work_id: string;
  author_id: string;
  body: string;
  answer: string;
  created_at: string;
  display_name: string;
  handle: string;
  avatar?: string | null;
};
export type Invitation = InvitationInput & {
  id: string;
  work_id: string;
  sender_id: string;
  recipient_id: string;
  state: 'pending' | 'accepted' | 'declined' | 'cancelled';
  created_at: string;
  sender_name: string;
  recipient_name: string;
  title: string;
  sender_contact: string;
  recipient_contact: string;
};
export type Notice = {
  id: string;
  actor_id: string;
  message: string;
  href: string;
  read: number;
  created_at: string;
};
const now = () => new Date().toISOString();

export class SocialStore {
  constructor(public store: Store) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS social_questions(id TEXT PRIMARY KEY,work_id TEXT NOT NULL REFERENCES works(id),author_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,answer TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS social_invitations(id TEXT PRIMARY KEY,work_id TEXT NOT NULL REFERENCES works(id),sender_id TEXT NOT NULL REFERENCES users(id),recipient_id TEXT NOT NULL REFERENCES users(id),data TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',sender_contact TEXT NOT NULL DEFAULT '',recipient_contact TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS social_pending_invitation ON social_invitations(work_id,sender_id) WHERE state='pending';
      CREATE TABLE IF NOT EXISTS social_blocks(user_id TEXT NOT NULL REFERENCES users(id),blocked_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(user_id,blocked_id));
      CREATE TABLE IF NOT EXISTS social_reports(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL REFERENCES users(id),question_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(reporter_id,question_id));
      CREATE TABLE IF NOT EXISTS social_notices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),actor_id TEXT NOT NULL REFERENCES users(id),work_id TEXT NOT NULL REFERENCES works(id),message TEXT NOT NULL,href TEXT NOT NULL,read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS social_withdraw AFTER DELETE ON publications BEGIN
        UPDATE social_invitations SET state='cancelled',sender_contact='',recipient_contact='' WHERE work_id=OLD.work_id;
      END;
      CREATE TRIGGER IF NOT EXISTS social_stop_sharing AFTER UPDATE OF share_to_feed ON publications WHEN NEW.share_to_feed=0 BEGIN
        UPDATE social_invitations SET state='cancelled',sender_contact='',recipient_contact='' WHERE work_id=NEW.work_id;
      END;
      CREATE TRIGGER IF NOT EXISTS social_withdraw_notices AFTER DELETE ON publications BEGIN
        DELETE FROM social_notices WHERE work_id=OLD.work_id;
      END;
      CREATE TRIGGER IF NOT EXISTS social_unshare_notices AFTER UPDATE OF share_to_feed ON publications WHEN NEW.share_to_feed=0 BEGIN
        DELETE FROM social_notices WHERE work_id=NEW.work_id;
      END;
      CREATE INDEX IF NOT EXISTS social_notices_user ON social_notices(user_id,created_at);
      CREATE INDEX IF NOT EXISTS social_questions_work ON social_questions(work_id,created_at);
      CREATE TABLE IF NOT EXISTS timeline_posts(id TEXT PRIMARY KEY,author_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,parent_id TEXT,work_id TEXT,body TEXT NOT NULL,data TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS timeline_posts_time ON timeline_posts(kind,created_at);
      CREATE INDEX IF NOT EXISTS timeline_posts_parent ON timeline_posts(parent_id,created_at);
      CREATE TABLE IF NOT EXISTS timeline_likes(user_id TEXT NOT NULL REFERENCES users(id),post_id TEXT NOT NULL,PRIMARY KEY(user_id,post_id));
      CREATE TABLE IF NOT EXISTS timeline_reports(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL REFERENCES users(id),post_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(reporter_id,post_id));
      CREATE TABLE IF NOT EXISTS timeline_joins(id TEXT PRIMARY KEY,post_id TEXT NOT NULL,applicant_id TEXT NOT NULL REFERENCES users(id),owner_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,work_id TEXT,message TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',applicant_contact TEXT NOT NULL DEFAULT '',owner_contact TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS timeline_pending_join ON timeline_joins(post_id,applicant_id) WHERE state IN ('pending','accepted');
      CREATE TABLE IF NOT EXISTS timeline_notices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),actor_id TEXT NOT NULL REFERENCES users(id),post_id TEXT NOT NULL,message TEXT NOT NULL,href TEXT NOT NULL,read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS timeline_notices_user ON timeline_notices(user_id,created_at);
    `);
  }
  blocked(a: string, b: string) {
    return !!this.store.db
      .query(
        'SELECT 1 FROM social_blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)',
      )
      .get(a, b, b, a);
  }
  shared(workId: string, viewer?: string) {
    const row = this.store.db
      .query(
        'SELECT w.owner_id,u.handle,p.data FROM publications p JOIN works w ON w.id=p.work_id JOIN users u ON u.id=w.owner_id WHERE p.work_id=? AND p.share_to_feed=1',
      )
      .get(workId) as { owner_id: string; handle: string; data: string } | null;
    if (!row || (viewer && this.blocked(viewer, row.owner_id)))
      throw new DomainError(404, '交流できる共有作品が見つかりません。ホームを確認してください。');
    return { ...row, title: JSON.parse(row.data).title as string };
  }
  feed(userId: string) {
    return this.store
      .published()
      .filter((w) => !this.blocked(userId, this.shared(w.work_id).owner_id));
  }
  notice(userId: string, actor: string, workId: string, message: string, href: string) {
    if (userId === actor) return;
    this.store.db
      .query('INSERT INTO social_notices VALUES(?,?,?,?,?,?,0,?)')
      .run(randomUUID(), userId, actor, workId, message, href, now());
  }
  timelineNotice(userId: string, actor: string, postId: string, message: string, href: string) {
    if (userId === actor) return;
    this.store.db
      .query('INSERT INTO timeline_notices VALUES(?,?,?,?,?,?,0,?)')
      .run(randomUUID(), userId, actor, postId, message, href, now());
  }
  notices(userId: string): Notice[] {
    const works = this.store.db
      .query(
        'SELECT n.* FROM social_notices n JOIN publications p ON p.work_id=n.work_id WHERE n.user_id=? AND p.share_to_feed=1 ORDER BY n.created_at DESC LIMIT 100',
      )
      .all(userId) as Notice[];
    const posts = this.store.db
      .query('SELECT * FROM timeline_notices WHERE user_id=? ORDER BY created_at DESC LIMIT 100')
      .all(userId) as Notice[];
    return [...works, ...posts]
      .filter((n) => !this.blocked(userId, n.actor_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 100);
  }
  read(userId: string) {
    this.store.db.query('UPDATE social_notices SET read=1 WHERE user_id=?').run(userId);
    this.store.db.query('UPDATE timeline_notices SET read=1 WHERE user_id=?').run(userId);
  }
  /** Mark notices caused by one person as read when their conversation is opened. */
  readFrom(userId: string, actorId: string) {
    for (const table of ['social_notices', 'timeline_notices'])
      this.store.db
        .query(`UPDATE ${table} SET read=1 WHERE user_id=? AND actor_id=?`)
        .run(userId, actorId);
  }
  questions(workId: string, viewer?: string): Question[] {
    this.shared(workId, viewer);
    return (
      this.store.db
        .query(
          'SELECT q.*,u.display_name,u.handle,pr.avatar_asset_id AS avatar FROM social_questions q JOIN users u ON u.id=q.author_id LEFT JOIN profiles pr ON pr.user_id=q.author_id WHERE q.work_id=? ORDER BY q.created_at DESC,q.rowid DESC LIMIT 100',
        )
        .all(workId) as Question[]
    )
      .reverse()
      .filter(
        (q) =>
          !viewer ||
          (!this.blocked(viewer, q.author_id) &&
            !this.store.db
              .query('SELECT 1 FROM social_reports WHERE reporter_id=? AND question_id=?')
              .get(viewer, q.id)),
      );
  }
  ask(userId: string, workId: string, input: string) {
    const work = this.shared(workId, userId),
      body = text(1000).parse(input);
    const count = this.store.db
      .query('SELECT count(*) AS n FROM social_questions WHERE author_id=? AND created_at>?')
      .get(userId, new Date(Date.now() - 3600000).toISOString()) as { n: number };
    if (count.n >= 20)
      throw new DomainError(429, '質問の回数が多くなっています。1時間後に試してください。');
    const id = randomUUID();
    this.store.db.transaction(() => {
      this.store.db
        .query(
          'INSERT INTO social_questions(id,work_id,author_id,body,created_at) VALUES(?,?,?,?,?)',
        )
        .run(id, workId, userId, body, now());
      this.notice(
        work.owner_id,
        userId,
        workId,
        `${this.store.user(userId).display_name}さんから作品への質問が届きました。`,
        `/u/${work.handle}/works/${workId}#conversation`,
      );
    })();
    return id;
  }
  question(id: string) {
    const q = this.store.db
      .query('SELECT * FROM social_questions WHERE id=?')
      .get(id) as Question | null;
    if (!q) throw new DomainError(404, '質問が見つかりません。作品ページを確認してください。');
    return q;
  }
  answer(userId: string, id: string, input: string) {
    const q = this.question(id),
      work = this.shared(q.work_id, userId),
      answer = text(2000).parse(input);
    if (work.owner_id !== userId || this.blocked(userId, q.author_id))
      throw new DomainError(403, 'この質問には返信できません。');
    this.store.db.transaction(() => {
      this.store.db.query('UPDATE social_questions SET answer=? WHERE id=?').run(answer, id);
      this.notice(
        q.author_id,
        userId,
        q.work_id,
        '作品への質問に返信が届きました。',
        `/u/${work.handle}/works/${q.work_id}#conversation`,
      );
    })();
    return q.work_id;
  }
  removeQuestion(userId: string, id: string) {
    const q = this.question(id);
    const owner = this.store.db.query('SELECT owner_id FROM works WHERE id=?').get(q.work_id) as {
      owner_id: string;
    };
    if (q.author_id !== userId && owner.owner_id !== userId)
      throw new DomainError(403, 'この質問は削除できません。');
    this.store.db.query('DELETE FROM social_questions WHERE id=?').run(id);
  }
  report(userId: string, id: string, reason: string) {
    const q = this.question(id);
    this.shared(q.work_id, userId);
    this.store.db
      .query(
        'INSERT INTO social_reports VALUES(?,?,?,?,?) ON CONFLICT(reporter_id,question_id) DO UPDATE SET reason=excluded.reason',
      )
      .run(randomUUID(), userId, id, text(1000).parse(reason), now());
  }
  invite(userId: string, workId: string, input: InvitationInput) {
    const work = this.shared(workId, userId),
      data = invitationSchema.parse(input);
    if (work.owner_id === userId)
      throw new DomainError(422, '他の人の作品から誘いを送ってください。');
    if (
      this.store.db
        .query(
          "SELECT id FROM social_invitations WHERE sender_id=? AND work_id=? AND state='pending'",
        )
        .get(userId, workId)
    )
      throw new DomainError(409, 'この作品への誘いは返事待ちです。交流画面で確認してください。');
    const count = this.store.db
      .query('SELECT count(*) AS n FROM social_invitations WHERE sender_id=? AND created_at>?')
      .get(userId, new Date(Date.now() - 86400000).toISOString()) as { n: number };
    if (count.n >= 10)
      throw new DomainError(429, '誘いの送信上限に達しました。翌日に試してください。');
    const id = randomUUID();
    this.store.db.transaction(() => {
      this.store.db
        .query(
          'INSERT INTO social_invitations(id,work_id,sender_id,recipient_id,data,created_at) VALUES(?,?,?,?,?,?)',
        )
        .run(id, workId, userId, work.owner_id, JSON.stringify(data), now());
      this.notice(
        work.owner_id,
        userId,
        workId,
        `${this.store.user(userId).display_name}さんから活動への誘いが届きました。`,
        '/connections',
      );
    })();
    return id;
  }
  invitations(userId: string): Invitation[] {
    const rows = this.store.db
      .query(
        `SELECT i.*,a.display_name AS sender_name,b.display_name AS recipient_name,p.data AS work_data FROM social_invitations i JOIN users a ON a.id=i.sender_id JOIN users b ON b.id=i.recipient_id JOIN publications p ON p.work_id=i.work_id WHERE (i.sender_id=? OR i.recipient_id=?) AND p.share_to_feed=1 ORDER BY i.created_at DESC LIMIT 100`,
      )
      .all(userId, userId) as (Invitation & { data: string; work_data: string })[];
    return rows
      .filter((i) => !this.blocked(i.sender_id, i.recipient_id))
      .map((i) => ({
        ...i,
        ...JSON.parse(i.data),
        title: JSON.parse(i.work_data).title,
        sender_contact: i.state === 'accepted' ? i.sender_contact : '',
        recipient_contact: i.state === 'accepted' ? i.recipient_contact : '',
      }));
  }
  invitation(userId: string, id: string) {
    const item = this.invitations(userId).find((i) => i.id === id);
    if (!item) throw new DomainError(404, '誘いが見つかりません。交流画面を確認してください。');
    return item;
  }
  decide(userId: string, id: string, state: 'accepted' | 'declined' | 'cancelled') {
    const item = this.invitation(userId, id);
    if ((state === 'cancelled' ? item.sender_id : item.recipient_id) !== userId)
      throw new DomainError(403, 'この誘いは操作できません。');
    if (item.state !== 'pending')
      throw new DomainError(409, '返事の状態が変わっています。交流画面を読み直してください。');
    this.store.db.transaction(() => {
      this.store.db.query('UPDATE social_invitations SET state=? WHERE id=?').run(state, id);
      this.notice(
        userId === item.sender_id ? item.recipient_id : item.sender_id,
        userId,
        item.work_id,
        state === 'accepted'
          ? '誘いが受け入れられました。連絡先を共有できます。'
          : state === 'declined'
            ? '誘いが見送られました。'
            : '誘いが取り消されました。',
        '/connections',
      );
    })();
  }
  contact(userId: string, id: string, input: string) {
    const item = this.invitation(userId, id);
    if (item.state !== 'accepted')
      throw new DomainError(409, '誘いが受け入れられた後に連絡先を共有できます。');
    const value = input.trim() === '' ? '' : webUrl.parse(input);
    const column = item.sender_id === userId ? 'sender_contact' : 'recipient_contact';
    this.store.db.query(`UPDATE social_invitations SET ${column}=? WHERE id=?`).run(value, id);
  }
  block(userId: string, other: string) {
    this.store.user(other);
    if (userId === other) throw new DomainError(422, '自分自身はブロックできません。');
    this.store.db.transaction(() => {
      this.store.db.query('INSERT OR IGNORE INTO social_blocks VALUES(?,?)').run(userId, other);
      this.store.db
        .query(
          "UPDATE social_invitations SET state='cancelled',sender_contact='',recipient_contact='' WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)",
        )
        .run(userId, other, other, userId);
      this.store.db
        .query(
          "UPDATE timeline_joins SET state='cancelled',applicant_contact='',owner_contact='' WHERE state IN ('pending','accepted') AND ((applicant_id=? AND owner_id=?) OR (applicant_id=? AND owner_id=?))",
        )
        .run(userId, other, other, userId);
    })();
  }
  unblock(userId: string, other: string) {
    this.store.db
      .query('DELETE FROM social_blocks WHERE user_id=? AND blocked_id=?')
      .run(userId, other);
  }
  blocks(userId: string) {
    return this.store.db
      .query(
        'SELECT u.id,u.display_name FROM social_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=?',
      )
      .all(userId) as { id: string; display_name: string }[];
  }
}
