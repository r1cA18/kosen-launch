import { Database } from 'bun:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { publicWork, workSchema, type WorkData } from './schema';

export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type User = {
  id: string;
  email: string;
  display_name: string;
  handle: string;
  school: string;
  department: string;
  grade: string;
};
export type Identity = { user: User; mode: 'session' | 'agent' };
export type Profile = {
  bio: string;
  avatar_asset_id: string | null;
  interests: string[];
  links: { label: string; url: string }[];
};
export type Work = {
  id: string;
  owner_id: string;
  source_key: string;
  revision: number;
  data: WorkData;
  published_revision: number | null;
  created_at: string;
  updated_at: string;
};
export type Published = {
  work_id: string;
  revision: number;
  data: Omit<WorkData, 'sources'>;
  share_to_feed: number;
  published_at: string;
  display_name: string;
  handle: string;
};
export type Proposal = {
  id: string;
  work_id: string;
  base_revision: number;
  data: WorkData;
  state: string;
  created_at: string;
};
export type Asset = { id: string; owner_id: string; mime: string; path: string; alt: string };
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
const secret = () => randomBytes(32).toString('base64url');

export class Store {
  db: Database;
  constructor(filename = ':memory:') {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new Database(filename, { create: true, strict: true });
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,display_name TEXT NOT NULL,handle TEXT UNIQUE NOT NULL,school TEXT NOT NULL,department TEXT NOT NULL,grade TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens(id TEXT PRIMARY KEY,hash TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),label TEXT NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),source_key TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,published_revision INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(owner_id,source_key));
      CREATE TABLE IF NOT EXISTS revisions(work_id TEXT NOT NULL REFERENCES works(id),revision INTEGER NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(work_id,revision));
      CREATE TABLE IF NOT EXISTS publications(work_id TEXT PRIMARY KEY REFERENCES works(id),revision INTEGER NOT NULL,data TEXT NOT NULL,share_to_feed INTEGER NOT NULL,published_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,work_id TEXT NOT NULL REFERENCES works(id),base_revision INTEGER NOT NULL,data TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),mime TEXT NOT NULL,path TEXT NOT NULL,alt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reactions(user_id TEXT NOT NULL REFERENCES users(id),work_id TEXT NOT NULL REFERENCES works(id),PRIMARY KEY(user_id,work_id));
      CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),bio TEXT NOT NULL DEFAULT '',avatar_asset_id TEXT REFERENCES assets(id),interests TEXT NOT NULL DEFAULT '[]',links TEXT NOT NULL DEFAULT '[]',updated_at TEXT NOT NULL);
    `);
  }
  close() {
    this.db.close();
  }
  user(id: string): User {
    const user = this.db
      .query('SELECT id,email,display_name,handle,school,department,grade FROM users WHERE id=?')
      .get(id) as User | null;
    if (!user) throw new DomainError(401, 'ログインしてください。');
    return user;
  }
  profileOf(userId: string): Profile {
    const row = this.db
      .query('SELECT bio,avatar_asset_id,interests,links FROM profiles WHERE user_id=?')
      .get(userId) as {
      bio: string;
      avatar_asset_id: string | null;
      interests: string;
      links: string;
    } | null;
    return row
      ? { ...row, interests: JSON.parse(row.interests), links: JSON.parse(row.links) }
      : { bio: '', avatar_asset_id: null, interests: [], links: [] };
  }
  updateProfile(userId: string, input: Profile) {
    if (input.avatar_asset_id) {
      const owner = this.db
        .query('SELECT owner_id FROM assets WHERE id=?')
        .get(input.avatar_asset_id) as { owner_id: string } | null;
      if (owner?.owner_id !== userId) throw new DomainError(404, '画像が見つかりません。');
    }
    this.db
      .query(
        'INSERT INTO profiles VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio,avatar_asset_id=excluded.avatar_asset_id,interests=excluded.interests,links=excluded.links,updated_at=excluded.updated_at',
      )
      .run(
        userId,
        input.bio,
        input.avatar_asset_id,
        JSON.stringify(input.interests),
        JSON.stringify(input.links),
        new Date().toISOString(),
      );
  }
  async register(input: (User & { password: string }) | (Omit<User, 'id'> & { password: string })) {
    const hash = await Bun.password.hash(input.password, { algorithm: 'argon2id' });
    const id = randomUUID();
    try {
      this.db
        .query('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
        .run(
          id,
          input.email,
          hash,
          input.display_name,
          input.handle,
          input.school,
          input.department,
          input.grade,
        );
    } catch (error) {
      if (String(error).includes('UNIQUE'))
        throw new DomainError(
          409,
          'このメールアドレスまたは公開IDは登録済みです。別の値を入力してください。',
        );
      throw error;
    }
    return this.user(id);
  }
  async login(email: string, password: string) {
    const row = this.db
      .query('SELECT id,password_hash FROM users WHERE email=?')
      .get(email.toLowerCase()) as { id: string; password_hash: string } | null;
    if (!row || !(await Bun.password.verify(password, row.password_hash)))
      throw new DomainError(401, 'メールアドレスまたはパスワードを確認してください。');
    return this.user(row.id);
  }
  session(userId: string) {
    const token = secret();
    this.db
      .query('INSERT INTO sessions VALUES(?,?,?)')
      .run(digest(token), userId, Date.now() + 7 * 86400000);
    return token;
  }
  logout(token: string) {
    this.db.query('DELETE FROM sessions WHERE hash=?').run(digest(token));
  }
  identity(token: string, mode: 'session' | 'agent'): Identity | null {
    const row =
      mode === 'session'
        ? this.db
            .query('SELECT user_id FROM sessions WHERE hash=? AND expires>?')
            .get(digest(token), Date.now())
        : this.db
            .query('SELECT user_id FROM tokens WHERE hash=? AND expires>? AND revoked=0')
            .get(digest(token), Date.now());
    return row ? { user: this.user((row as { user_id: string }).user_id), mode } : null;
  }
  createToken(userId: string, label: string) {
    const token = 'klp_' + secret(),
      id = randomUUID(),
      expires = Date.now() + 7 * 86400000;
    this.db
      .query('INSERT INTO tokens VALUES(?,?,?,?,?,0,?)')
      .run(id, digest(token), userId, label, expires, now());
    return { id, token, expires };
  }
  tokens(userId: string) {
    return this.db
      .query(
        'SELECT id,label,expires,revoked,created_at FROM tokens WHERE user_id=? ORDER BY created_at DESC',
      )
      .all(userId) as { id: string; label: string; expires: number; revoked: number }[];
  }
  revoke(userId: string, id: string) {
    this.db.query('UPDATE tokens SET revoked=1 WHERE user_id=? AND id=?').run(userId, id);
  }
  private parseWork(row: unknown): Work {
    const value = row as Omit<Work, 'data'> & { data: string };
    return { ...value, data: JSON.parse(value.data) };
  }
  works(userId: string) {
    return this.db
      .query('SELECT * FROM works WHERE owner_id=? ORDER BY updated_at DESC')
      .all(userId)
      .map((r) => this.parseWork(r));
  }
  work(userId: string, id: string): Work {
    const row = this.db.query('SELECT * FROM works WHERE id=? AND owner_id=?').get(id, userId);
    if (!row) throw new DomainError(404, '作品が見つかりません。作品一覧を確認してください。');
    return this.parseWork(row);
  }
  validateAssets(userId: string, work: WorkData) {
    for (const id of work.asset_ids)
      if (!this.db.query('SELECT id FROM assets WHERE id=? AND owner_id=?').get(id, userId))
        throw new DomainError(422, '使用できない画像があります。自分の画像を追加してください。');
  }
  createWork(userId: string, sourceKey: string, input: WorkData) {
    const data = workSchema.parse(input);
    this.validateAssets(userId, data);
    const existing = this.db
      .query('SELECT * FROM works WHERE owner_id=? AND source_key=?')
      .get(userId, sourceKey);
    if (existing) return { work: this.parseWork(existing), created: false };
    const id = randomUUID(),
      time = now(),
      json = JSON.stringify(data);
    this.db.transaction(() => {
      this.db
        .query('INSERT INTO works VALUES(?,?,?,1,?,NULL,?,?)')
        .run(id, userId, sourceKey, json, time, time);
      this.db.query('INSERT INTO revisions VALUES(?,1,?,?)').run(id, json, time);
    })();
    return { work: this.work(userId, id), created: true };
  }
  updateWork(userId: string, id: string, base: number, input: WorkData): Work {
    const data = workSchema.parse(input);
    this.validateAssets(userId, data);
    return this.db.transaction(() => {
      const current = this.work(userId, id);
      if (current.revision !== base)
        throw new DomainError(
          409,
          '新しい変更があります。画面を再読み込みして内容を確認してください。',
        );
      const revision = base + 1,
        json = JSON.stringify(data),
        time = now();
      this.db
        .query('UPDATE works SET revision=?,data=?,updated_at=? WHERE id=?')
        .run(revision, json, time, id);
      this.db.query('INSERT INTO revisions VALUES(?,?,?,?)').run(id, revision, json, time);
      return this.work(userId, id);
    })();
  }
  propose(userId: string, id: string, base: number, data: WorkData) {
    const current = this.work(userId, id);
    this.validateAssets(userId, data);
    if (current.revision !== base)
      throw new DomainError(409, '作品が更新されています。最新の版を取得して提案してください。');
    const proposalId = randomUUID();
    this.db
      .query('INSERT INTO proposals(id,work_id,base_revision,data,created_at) VALUES(?,?,?,?,?)')
      .run(proposalId, id, base, JSON.stringify(workSchema.parse(data)), now());
    return { proposal_id: proposalId, work_id: id, base_revision: base };
  }
  proposals(userId: string, id: string): Proposal[] {
    this.work(userId, id);
    return this.db
      .query("SELECT * FROM proposals WHERE work_id=? AND state='pending' ORDER BY created_at DESC")
      .all(id)
      .map((row) => {
        const r = row as Omit<Proposal, 'data'> & { data: string };
        return { ...r, data: JSON.parse(r.data) };
      });
  }
  resolveProposal(userId: string, id: string, accept: boolean) {
    return this.db.transaction(() => {
      const row = this.db
        .query("SELECT * FROM proposals WHERE id=? AND state='pending'")
        .get(id) as { work_id: string; base_revision: number; data: string } | null;
      if (!row) throw new DomainError(404, '更新案が見つかりません。');
      this.work(userId, row.work_id);
      if (accept) this.updateWork(userId, row.work_id, row.base_revision, JSON.parse(row.data));
      this.db
        .query('UPDATE proposals SET state=? WHERE id=?')
        .run(accept ? 'accepted' : 'dismissed', id);
      return row.work_id;
    })();
  }
  publish(userId: string, id: string, revision: number, share: boolean) {
    return this.db.transaction(() => {
      const work = this.work(userId, id);
      if (work.revision !== revision)
        throw new DomainError(409, '公開前に最新のプレビューを確認してください。');
      const data = JSON.stringify(publicWork(work.data));
      this.db
        .query(
          'INSERT INTO publications VALUES(?,?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET revision=excluded.revision,data=excluded.data,share_to_feed=excluded.share_to_feed,published_at=excluded.published_at',
        )
        .run(id, revision, data, share ? 1 : 0, now());
      this.db.query('UPDATE works SET published_revision=? WHERE id=?').run(revision, id);
      return `/u/${this.user(userId).handle}/works/${id}`;
    })();
  }
  withdraw(userId: string, id: string) {
    this.work(userId, id);
    this.db.transaction(() => {
      this.db.query('DELETE FROM publications WHERE work_id=?').run(id);
      this.db.query('UPDATE works SET published_revision=NULL WHERE id=?').run(id);
      this.db.query('DELETE FROM reactions WHERE work_id=?').run(id);
    })();
  }
  published(handle?: string): Published[] {
    const sql =
      'SELECT p.*,u.display_name,u.handle FROM publications p JOIN works w ON w.id=p.work_id JOIN users u ON u.id=w.owner_id';
    const rows = handle
      ? this.db.query(sql + ' WHERE u.handle=? ORDER BY p.published_at DESC').all(handle)
      : this.db.query(sql + ' WHERE p.share_to_feed=1 ORDER BY p.published_at DESC LIMIT 50').all();
    return rows.map((row) => {
      const r = row as Omit<Published, 'data'> & { data: string };
      return { ...r, data: JSON.parse(r.data) };
    });
  }
  profile(handle: string) {
    return this.db.query('SELECT display_name,handle FROM users WHERE handle=?').get(handle) as {
      display_name: string;
      handle: string;
    } | null;
  }
  addAsset(userId: string, mime: string, path: string, alt: string) {
    const id = randomUUID();
    this.db.query('INSERT INTO assets VALUES(?,?,?,?,?)').run(id, userId, mime, path, alt);
    return id;
  }
  asset(id: string, userId?: string): Asset {
    const asset = this.db.query('SELECT * FROM assets WHERE id=?').get(id) as Asset | null;
    if (!asset) throw new DomainError(404, '画像が見つかりません。');
    if (asset.owner_id === userId) return asset;
    if (this.db.query('SELECT user_id FROM profiles WHERE avatar_asset_id=?').get(id)) return asset;
    const visible = this.db
      .query(
        "SELECT p.work_id FROM publications p, json_each(p.data,'$.asset_ids') a WHERE a.value=? LIMIT 1",
      )
      .get(id);
    if (!visible) throw new DomainError(404, '画像が見つかりません。');
    return asset;
  }
  react(userId: string, id: string) {
    if (
      !this.db.query('SELECT work_id FROM publications WHERE work_id=? AND share_to_feed=1').get(id)
    )
      throw new DomainError(404, '共有された作品が見つかりません。');
    const existing = this.db
      .query('SELECT user_id FROM reactions WHERE user_id=? AND work_id=?')
      .get(userId, id);
    if (existing)
      this.db.query('DELETE FROM reactions WHERE user_id=? AND work_id=?').run(userId, id);
    else this.db.query('INSERT INTO reactions VALUES(?,?)').run(userId, id);
  }
  reactionCount(id: string) {
    return (
      this.db.query('SELECT count(*) AS n FROM reactions WHERE work_id=?').get(id) as { n: number }
    ).n;
  }
  reacted(userId: string, id: string) {
    return !!this.db
      .query('SELECT user_id FROM reactions WHERE user_id=? AND work_id=?')
      .get(userId, id);
  }
}
