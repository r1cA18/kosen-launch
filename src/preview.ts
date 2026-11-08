import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import type { Store } from './store';

/**
 * Site previews for events: OGP image, site name, description and favicon of the official
 * page. The server downloads the images; browsers only ever load them from this origin.
 */
export type Preview = {
  url: string;
  image_id: string | null;
  image_mime: string | null;
  icon_id: string | null;
  icon_mime: string | null;
  site_name: string;
  title: string;
  description: string;
  fetched_at: string;
  error: string;
};
export type PreviewOptions = {
  /** Directory that holds the downloaded images (created on demand). */
  directory: string;
  /** Resolves a host name to its addresses. Replaceable for tests. */
  lookup?: (host: string) => Promise<string[]>;
  /** HTTP client. Replaceable for tests. It must not follow redirects on its own. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  now?: () => number;
};
export const HTML_LIMIT = 1024 * 1024;
export const IMAGE_LIMIT = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const RETRY = 86400000;
const CONCURRENCY = 3;

export class PreviewError extends Error {}

function v4(ip: string): number[] | null {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  const n = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  return n.some((x) => !(x >= 0 && x <= 255)) ? null : n;
}
function blockedV4([a, b, c]: number[]) {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c <= 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}
function groupsV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const q = v4(tail[1]);
    if (!q) return null;
    s =
      s.slice(0, -tail[1].length) +
      ((q[0] << 8) | q[1]).toString(16) +
      ':' +
      ((q[2] << 8) | q[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...rest];
  const n = all.map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN));
  return n.length === 8 && !n.some(Number.isNaN) ? n : null;
}
/** True for addresses that are not public unicast: private, loopback, link-local, reserved. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '');
  if (isIP(ip) === 4) {
    const q = v4(ip);
    return !q || blockedV4(q);
  }
  if (isIP(ip) !== 6) return true;
  const g = groupsV6(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => blockedV4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0))
    return embedded(g[6], g[7]); // ::ffff:a.b.c.d, ::a.b.c.d, ::, ::1
  if (g[0] === 0x64 && g[1] === 0xff9b) return embedded(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  if (g[0] === 0x2001 && (g[1] === 0xdb8 || g[1] === 0)) return true; // documentation, Teredo
  return g[0] < 0x2000 || g[0] > 0x3fff; // only global unicast
}
const hostBlocked = (h: string) =>
  /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i.test(h) || !h.includes('.');
async function defaultLookup(host: string) {
  return (await lookup(host, { all: true })).map((a) => a.address);
}

/** Checks one URL: scheme, credentials, port, host name and every resolved address. */
export async function assertPublicUrl(
  value: string,
  resolve: (host: string) => Promise<string[]> = defaultLookup,
): Promise<URL> {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new PreviewError('invalid_url');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new PreviewError('invalid_scheme');
  if (u.username || u.password) throw new PreviewError('credentials');
  if (u.port && u.port !== (u.protocol === 'https:' ? '443' : '80'))
    throw new PreviewError('invalid_port');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!isIP(host) && hostBlocked(host)) throw new PreviewError('blocked_host');
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (!addresses.length) throw new PreviewError('unresolved');
  if (addresses.some(isBlockedAddress)) throw new PreviewError('blocked_address');
  return u;
}

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      try {
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      } catch {
        return m;
      }
    }
    return entities[e.toLowerCase()] ?? m;
  });
}
function attrs(tag: string) {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g))
    out[m[1].toLowerCase()] ??= decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}
const clean = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);
export type Extracted = {
  images: string[];
  icons: string[];
  site_name: string;
  title: string;
  description: string;
};
const resolveUrl = (v: string, base: string) => {
  try {
    const u = new URL(v.trim(), base);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
};
/** Reads OGP, Twitter card and icon links out of an HTML document. Relative URLs resolve against `base`. */
export function extractPreview(html: string, base: string): Extracted {
  const meta = new Map<string, string>();
  const icons: { href: string; rank: number }[] = [];
  let title = '';
  for (const m of html.matchAll(/<(meta|link)\b([^>]*)>/gi)) {
    const a = attrs(m[2]);
    if (m[1].toLowerCase() === 'meta') {
      const key = (a.property ?? a.name ?? '').toLowerCase();
      if (key && a.content !== undefined && !meta.has(key)) meta.set(key, a.content);
    } else if (a.href) {
      const rel = (a.rel ?? '').toLowerCase().split(/\s+/);
      if (rel.includes('icon')) icons.push({ href: a.href, rank: 0 });
      else if (rel.includes('apple-touch-icon')) icons.push({ href: a.href, rank: 1 });
    }
  }
  const t = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (t) title = t[1];
  const first = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v?.trim()) ?? '';
  const unique = (list: (string | null)[]) => [...new Set(list.filter((x): x is string => !!x))];
  const origin = resolveUrl('/favicon.ico', base);
  return {
    images: unique(
      ['og:image', 'og:image:secure_url', 'og:image:url', 'twitter:image', 'twitter:image:src']
        .map((k) => meta.get(k))
        .filter((v): v is string => !!v?.trim())
        .map((v) => resolveUrl(v, base)),
    ),
    icons: unique([
      ...icons.sort((x, y) => x.rank - y.rank).map((i) => resolveUrl(i.href, base)),
      origin,
    ]),
    site_name: clean(first('og:site_name', 'application-name'), 100),
    title: clean(first('og:title', 'twitter:title') || title, 200),
    description: clean(first('og:description', 'twitter:description', 'description'), 300),
  };
}

type Kind = { mime: string; ext: string };
/** Magic-byte check. Returns null for anything that is not a displayable image. */
export function sniffImage(b: Uint8Array): Kind | null {
  const at = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v))
    return { mime: 'image/png', ext: 'png' };
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return { mime: 'image/jpeg', ext: 'jpg' };
  if (at(0, 'RIFF') && at(8, 'WEBP')) return { mime: 'image/webp', ext: 'webp' };
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return { mime: 'image/gif', ext: 'gif' };
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && (b[4] || b[5]))
    return { mime: 'image/x-icon', ext: 'ico' };
  const head = new TextDecoder().decode(b.slice(0, 1024)).replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)?(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(head))
    return { mime: 'image/svg+xml', ext: 'svg' };
  return null;
}
const imageTypes = /^image\/(png|jpe?g|webp|gif|x-icon|vnd\.microsoft\.icon|svg\+xml)$/i;

async function readLimited(res: Response, limit: number) {
  const declared = Number(res.headers.get('content-length'));
  if (declared > limit) throw new PreviewError('too_large');
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      void reader.cancel().catch(() => {});
      throw new PreviewError('too_large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
function decodeHtml(bytes: Uint8Array, contentType: string) {
  const label = (s: string | undefined) => s?.trim().replace(/^["']|["']$/g, '');
  let charset = label(contentType.match(/charset=([^;]+)/i)?.[1]);
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
    charset = label(
      head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1] ??
        head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1],
    );
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export class Previews {
  private queue: string[] = [];
  private pending = new Set<string>();
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(
    public store: Store,
    public options: PreviewOptions,
  ) {
    store.db.exec(
      `CREATE TABLE IF NOT EXISTS event_previews(url TEXT PRIMARY KEY,image_id TEXT,image_mime TEXT,icon_id TEXT,icon_mime TEXT,site_name TEXT NOT NULL DEFAULT '',title TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',fetched_at TEXT NOT NULL,error TEXT NOT NULL DEFAULT '')`,
    );
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  get(url: string): Preview | null {
    return this.store.db
      .query('SELECT * FROM event_previews WHERE url=?')
      .get(url) as Preview | null;
  }
  /** A preview is fetched once. A failure is retried after 24 hours. */
  needs(url: string) {
    const p = this.get(url);
    return !p || (!!p.error && Date.parse(p.fetched_at) < this.now() - RETRY);
  }
  /** Queues missing previews and returns at once. Never throws. */
  ensure(urls: string[]) {
    for (const url of new Set(urls))
      if (!this.pending.has(url) && this.needs(url)) {
        this.pending.add(url);
        this.queue.push(url);
      }
    this.pump();
  }
  /** Resolves when every queued fetch has finished. */
  idle() {
    return this.active || this.queue.length
      ? new Promise<void>((r) => this.waiters.push(r))
      : Promise.resolve();
  }
  private pump() {
    while (this.active < CONCURRENCY && this.queue.length) {
      const url = this.queue.shift()!;
      this.active++;
      void this.fetchOne(url)
        .catch(() => {})
        .finally(() => {
          this.active--;
          this.pending.delete(url);
          this.pump();
          if (!this.active && !this.queue.length) for (const w of this.waiters.splice(0)) w();
        });
    }
  }
  /** GET with a per-hop address check. Redirects are followed at most 3 times. */
  private async get1(start: string, limit: number, signal: AbortSignal, accept: string) {
    let url = start;
    for (let hop = 0; ; hop++) {
      const u = await assertPublicUrl(url, this.options.lookup);
      const res = await (this.options.fetch ?? fetch)(u.href, {
        redirect: 'manual',
        signal,
        headers: { Accept: accept, 'User-Agent': 'KosenLaunchPreview/1.0' },
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        void res.body?.cancel().catch(() => {});
        if (hop >= MAX_REDIRECTS) throw new PreviewError('too_many_redirects');
        url = new URL(location, u).href;
        continue;
      }
      if (!res.ok) {
        void res.body?.cancel().catch(() => {});
        throw new PreviewError(`status_${res.status}`);
      }
      return { res, url: u.href, bytes: await readLimited(res, limit) };
    }
  }
  private async saveImage(url: string) {
    const signal = AbortSignal.timeout(this.options.timeoutMs ?? 8000);
    const { res, bytes } = await this.get1(url, IMAGE_LIMIT, signal, 'image/*');
    const type = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
    const kind = sniffImage(bytes);
    if (!imageTypes.test(type) || !kind) throw new PreviewError('not_image');
    await mkdir(this.options.directory, { recursive: true });
    const id = randomUUID();
    await Bun.write(join(this.options.directory, id), bytes);
    return { id, mime: kind.mime };
  }
  private async firstImage(urls: string[], max: number) {
    for (const u of urls.slice(0, max))
      try {
        return await this.saveImage(u);
      } catch {
        // try the next candidate
      }
    return null;
  }
  /** Fetches and stores the preview of one page. Failures are stored, not thrown. */
  async fetchOne(url: string): Promise<Preview> {
    const row: Preview = {
      url,
      image_id: null,
      image_mime: null,
      icon_id: null,
      icon_mime: null,
      site_name: '',
      title: '',
      description: '',
      fetched_at: new Date(this.now()).toISOString(),
      error: '',
    };
    try {
      const signal = AbortSignal.timeout(this.options.timeoutMs ?? 8000);
      const page = await this.get1(url, HTML_LIMIT, signal, 'text/html,application/xhtml+xml');
      const type = page.res.headers.get('content-type') ?? '';
      if (!/^(text\/html|application\/xhtml\+xml)/i.test(type)) throw new PreviewError('not_html');
      const found = extractPreview(decodeHtml(page.bytes, type), page.url);
      Object.assign(row, {
        site_name: found.site_name,
        title: found.title,
        description: found.description,
      });
      const image = await this.firstImage(found.images, 2);
      const icon = await this.firstImage(found.icons, 2);
      if (image) Object.assign(row, { image_id: image.id, image_mime: image.mime });
      if (icon) Object.assign(row, { icon_id: icon.id, icon_mime: icon.mime });
    } catch (e) {
      row.error =
        e instanceof PreviewError
          ? e.message
          : e instanceof Error && e.name === 'TimeoutError'
            ? 'timeout'
            : 'fetch_failed';
    }
    try {
      this.store.db
        .query('INSERT OR REPLACE INTO event_previews VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(
          row.url,
          row.image_id,
          row.image_mime,
          row.icon_id,
          row.icon_mime,
          row.site_name,
          row.title,
          row.description,
          row.fetched_at,
          row.error,
        );
    } catch {
      // The database may be closed while a background fetch finishes.
    }
    return row;
  }
  /** Image row for a stored id, only when the person has a suggestion or opportunity with that page. */
  imageFor(userId: string, id: string): { path: string; mime: string } | null {
    const row = this.store.db
      .query(
        `SELECT p.image_id,p.image_mime,p.icon_id,p.icon_mime FROM event_previews p WHERE (p.image_id=?1 OR p.icon_id=?1) AND (
          EXISTS(SELECT 1 FROM event_suggestions s WHERE s.user_id=?2 AND s.url=p.url) OR
          EXISTS(SELECT 1 FROM opportunities o WHERE o.user_id=?2 AND json_extract(o.data,'$.url')=p.url))`,
      )
      .get(id, userId) as Pick<Preview, 'image_id' | 'image_mime' | 'icon_id' | 'icon_mime'> | null;
    if (!row) return null;
    const mime = row.image_id === id ? row.image_mime : row.icon_mime;
    return mime ? { path: join(this.options.directory, id), mime } : null;
  }
  /** Queues previews for suggestions and opportunities that have none. Returns the URLs queued for checking. */
  ensureAll(): string[] {
    const urls = [
      ...(this.store.db
        .query("SELECT url FROM event_suggestions WHERE state!='dismissed'")
        .all() as { url: string }[]),
      ...(this.store.db
        .query("SELECT json_extract(data,'$.url') AS url FROM opportunities")
        .all() as { url: string }[]),
    ].map((r) => r.url);
    this.ensure(urls);
    return urls;
  }
}
