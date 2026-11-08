import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Store, DomainError, type Identity } from './store';
import { ProfilePage } from './profile-ui';
import { SettingsPage, type SettingsTab } from './settings-ui';
import { SocialStore, invitationSchema } from './social';
import { TimelineStore, parseRoles } from './timeline';
import { Timeline, TimelinePostPage } from './timeline-ui';
import { Opportunities, opportunitySchema, planState, type ClaudeOptions } from './opportunities';
import { Conversation, ConnectionsPage } from './social-ui';
import { EventsPage, EventsRail, OpportunityPage, type EventsTab } from './events-ui';
import { Discovery, type DiscoveryOptions } from './discovery';
import type { Previews } from './preview';
import {
  registrationSchema,
  createWorkSchema,
  updateWorkSchema,
  publishSchema,
  workSchema,
  authoringRules,
  profileSchema,
} from './schema';
import {
  LandingPage,
  AuthPage,
  HomePage,
  WorksPage,
  WorkEditor,
  PreviewPage,
  DraftsRail,
  ReviewPage,
  PublicWorkPage,
  ErrorPage,
} from './ui';
import { ConsolePage, BulkTextPage } from './console-ui';
import { applyAllFixes, applyFix, isEditableField, replaceAll } from './console';
import { applySchema, type UiEditor } from './ui-editor';
import { EditorPage } from './editor-ui';
import { WelcomePage } from './welcome-ui';
import { NextSection } from './home-ui';
import { layoutOf, withLayout } from './layout';
import { remotePaths, remoteRoutes } from './remote';

type Env = { Variables: { identity: Identity | null } };
/** Only an OAuth consent request may be a return path after signing in. */
const nextPath = (value: string | undefined) =>
  value && /^\/oauth\/authorize\?[^\s\\]*$/.test(value) ? value : undefined;
type Options = {
  origin: string;
  assetDirectory: string;
  staticDirectory: string;
  skillPath: string;
  claude?: ClaudeOptions & Pick<DiscoveryOptions, 'rustxng'>;
  uiEditor?: UiEditor;
  /** Site previews for events. Without it previews are neither fetched nor shown. */
  previews?: Previews;
  /** When set, new accounts need this invite code (public demo deployments). */
  registrationCode?: string;
};
const fieldHints: Record<string, string> = {
  handle: '公開IDは小文字の英字で始まり、小文字・数字・ハイフンの3〜30文字で入力してください。',
  password: 'パスワードは10〜128文字で入力してください。',
  email: 'メールアドレスの形式を確認してください。',
  display_name: '表示名を60文字以内で入力してください。',
};
/** Names the first invalid field when it is one people commonly get wrong. */
function fieldMessage(error: z.ZodError) {
  const field = String(error.issues[0]?.path[0] ?? '');
  return fieldHints[field] ?? '入力内容を確認してください。必須項目と文字数を見直してください。';
}
export function createApp(store: Store, options: Options) {
  const app = new Hono<Env>();
  const social = new SocialStore(store);
  const timeline = new TimelineStore(store, social);
  const opportunities = new Opportunities(store, options.claude);
  const discovery = new Discovery(store, opportunities, options.claude, options.previews);
  const origin = new URL(options.origin).origin;
  const attempts = new Map<string, { count: number; until: number }>();
  app.use(
    '*',
    bodyLimit({
      maxSize: 7 * 1024 * 1024,
      onError: (c) =>
        c.json({ error: '送信する内容が大きすぎます。画像は5MB以内にしてください。' }, 413),
    }),
  );
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    if (origin.startsWith('https:'))
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
    );
    const bearer = c.req.header('Authorization');
    const identity = bearer?.startsWith('Bearer ')
      ? store.identity(bearer.slice(7), 'agent')
      : store.identity(getCookie(c, 'kl_session') ?? '', 'session');
    c.set('identity', identity);
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      !(identity?.mode === 'agent' && c.req.path.startsWith('/v1/')) &&
      !remotePaths.includes(c.req.path) &&
      c.req.header('Origin') !== origin
    )
      throw new DomainError(403, 'この画面からもう一度操作してください。');
    await next();
  });
  const editor = options.uiEditor;
  const loopback = (c: Context<Env>) =>
    ['127.0.0.1', 'localhost'].includes(new URL(c.req.url).hostname.replace(/^\[|\]$/g, '')) &&
    /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(c.req.header('Host') ?? new URL(c.req.url).host);
  if (editor) {
    app.use('*', async (c, next) => {
      await next();
      if (!loopback(c) || !c.res.headers.get('Content-Type')?.includes('text/html')) return;
      const html = await c.res.text();
      const headers = new Headers(c.res.headers);
      headers.delete('Content-Length');
      c.res = new Response(
        html.replace(
          '</head>',
          '<link rel="stylesheet" href="/__ui-editor/editor.css" /><script src="/__ui-editor/editor.js" defer></script></head>',
        ),
        { status: c.res.status, headers },
      );
    });
    for (const [name, type] of [
      ['editor.js', 'text/javascript'],
      ['editor.css', 'text/css'],
    ])
      app.get(`/__ui-editor/${name}`, async (c) => {
        if (!loopback(c)) throw new DomainError(404, 'ページが見つかりません。');
        c.header('Content-Type', type);
        return c.body(
          await Bun.file(join(options.staticDirectory, `ui-editor.${name.split('.')[1]}`)).text(),
        );
      });
    app.post('/__ui-editor/apply', async (c) => {
      if (!loopback(c)) throw new DomainError(404, 'ページが見つかりません。');
      const { results, write } = await editor.plan(applySchema.parse(await c.req.json()));
      setTimeout(() => void write().catch(() => console.error('UI editor write failed')), 300);
      return c.json({ results });
    });
  }
  const checkInvite = (code: unknown) => {
    const expected = options.registrationCode;
    if (!expected) return;
    const given = new TextEncoder().encode(String(code ?? ''));
    const want = new TextEncoder().encode(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want))
      throw new DomainError(403, '招待コードを確認してください。');
  };
  const requireUser = (c: Context<Env>, webOnly = false): Identity => {
    const identity = c.get('identity') as Identity | null;
    if (!identity) throw new DomainError(401, 'ログインしてください。');
    if (webOnly && identity.mode !== 'session')
      throw new DomainError(403, 'この操作は本人がWebで確認して行ってください。');
    return identity;
  };
  const authenticate = (c: Context<Env>, userId: string) =>
    setCookie(c, 'kl_session', store.session(userId), {
      httpOnly: true,
      secure: origin.startsWith('https:'),
      sameSite: 'Lax',
      path: '/',
      maxAge: 7 * 86400,
    });
  const throttle = (email: string) => {
    const key = email.toLowerCase(),
      existing = attempts.get(key),
      time = Date.now();
    if (existing && existing.until > time && existing.count >= 12)
      throw new DomainError(429, '試行回数が多くなっています。15分後に試してください。');
    if (attempts.size > 1000)
      for (const [k, v] of attempts) if (v.until <= time) attempts.delete(k);
    attempts.set(key, {
      count: existing && existing.until > time ? existing.count + 1 : 1,
      until: existing && existing.until > time ? existing.until : time + 15 * 60000,
    });
  };
  const upload = async (userId: string, file: File, alt: string) => {
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024)
      throw new DomainError(422, '5MB以内のPNG・JPEG・WebPを選んでください。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp =
      new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
    const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : webp ? 'image/webp' : null;
    if (!mime) throw new DomainError(422, 'PNG・JPEG・WebPの画像を選んでください。');
    const description = z.string().trim().min(1).max(200).parse(alt);
    await mkdir(options.assetDirectory, { recursive: true });
    const path = join(options.assetDirectory, randomUUID());
    await Bun.write(path, bytes);
    return store.addAsset(userId, mime, path, description);
  };
  app.onError((error, c) => {
    const status =
      error instanceof DomainError ? error.status : error instanceof z.ZodError ? 422 : 500;
    const message =
      error instanceof DomainError
        ? error.message
        : error instanceof z.ZodError
          ? fieldMessage(error)
          : '処理を完了できませんでした。時間をおいてもう一度試してください。';
    if (status === 500)
      console.error('Request failed:', error instanceof Error ? error.name : 'unknown');
    if (c.req.path.startsWith('/v1/'))
      return c.json({ error: message }, status as ContentfulStatusCode);
    if (c.req.path === '/register' || c.req.path === '/login')
      return c.html(
        <AuthPage
          register={c.req.path === '/register'}
          invite={!!options.registrationCode}
          error={message}
          next={nextPath(c.req.query('next'))}
        />,
        status as ContentfulStatusCode,
      );
    return c.html(
      <ErrorPage message={message} user={c.get('identity')?.user} />,
      status as ContentfulStatusCode,
    );
  });
  app.get('/health', (c) => c.json({ ok: true }));
  for (const [route, type] of [
    ['style.css', 'text/css'],
    ['fonts.css', 'text/css'],
    ['app.js', 'text/javascript'],
    ['client.js', 'text/javascript'],
    ['editor.js', 'text/javascript'],
    ['LICENSE-meniscus.txt', 'text/plain; charset=utf-8'],
    ['console.js', 'text/javascript'],
    ['favicon.svg', 'image/svg+xml'],
  ])
    app.get('/' + route, async (c) => {
      c.header('Content-Type', type);
      return c.body(await Bun.file(join(options.staticDirectory, route)).text());
    });
  app.get('/fonts/:name', async (c) => {
    const name = c.req.param('name');
    if (!/^[-a-z0-9]+\.woff2$/.test(name)) throw new DomainError(404, 'ファイルが見つかりません。');
    const file = Bun.file(join(options.staticDirectory, 'fonts', name));
    if (!(await file.exists())) throw new DomainError(404, 'ファイルが見つかりません。');
    c.header('Content-Type', 'font/woff2');
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(await file.arrayBuffer());
  });
  app.get('/', (c) => (c.get('identity') ? c.redirect('/home') : c.html(<LandingPage />)));
  app.get('/register', (c) =>
    c.html(
      <AuthPage
        register
        invite={!!options.registrationCode}
        next={nextPath(c.req.query('next'))}
      />,
    ),
  );
  app.get('/login', (c) => {
    const next = nextPath(c.req.query('next'));
    if (next && c.get('identity')?.mode === 'session') return c.redirect(next, 302);
    return c.html(<AuthPage next={next} />);
  });
  app.post('/register', async (c) => {
    const { invite_code, ...body } = await c.req.parseBody();
    checkInvite(invite_code);
    const input = registrationSchema.parse(body);
    throttle(input.email);
    const user = await store.register(input);
    authenticate(c, user.id);
    return c.redirect(nextPath(c.req.query('next')) ?? '/welcome', 303);
  });
  app.get('/welcome', (c) => {
    const { user } = requireUser(c, true);
    return c.html(
      <WelcomePage
        user={user}
        profile={store.profileOf(user.id)}
        works={store.works(user.id).length}
        connected={store.tokens(user.id).some((t) => !t.revoked)}
      />,
    );
  });
  app.post('/login', async (c) => {
    const body = z
      .object({ email: z.email().max(254), password: z.string().max(128) })
      .parse(await c.req.parseBody());
    throttle(body.email);
    const user = await store.login(body.email, body.password);
    authenticate(c, user.id);
    return c.redirect(nextPath(c.req.query('next')) ?? '/home', 303);
  });
  app.post('/logout', (c) => {
    requireUser(c, true);
    store.logout(getCookie(c, 'kl_session') ?? '');
    deleteCookie(c, 'kl_session', { path: '/' });
    return c.redirect('/login', 303);
  });
  app.get('/home', (c) => {
    const { user } = requireUser(c, true);
    const role = c.req.query('role')?.slice(0, 30) || undefined;
    const profile = store.profileOf(user.id);
    const works = store.works(user.id);
    const proposals = Object.fromEntries(
      works.map((w) => [w.id, store.proposals(user.id, w.id).length]),
    );
    discovery.ensure(user.id);
    const top = opportunities.forYou(user.id, 1)[0];
    if (top) options.previews?.ensure([top.url]);
    return c.html(
      <HomePage
        user={user}
        setupProfile={!profile.bio && !profile.interests.length}
        next={
          <NextSection
            event={top}
            preview={top ? (options.previews?.get(top.url) ?? null) : null}
            joins={timeline.pendingJoins(user.id)}
            invitations={social
              .invitations(user.id)
              .filter((i) => i.recipient_id === user.id && i.state === 'pending')}
            drafts={works.filter(
              (w) => (!w.published_revision && w.revision === 1) || proposals[w.id] > 0,
            )}
            proposals={proposals}
          />
        }
      >
        <Timeline
          user={user}
          timeline={timeline}
          works={works}
          unread={0}
          view={{
            filter: c.req.query('filter') === 'all' ? 'all' : 'recruit',
            role,
            compose: c.req.query('compose') === 'recruit' ? 'recruit' : 'progress',
            prefill: {
              title: c.req.query('title')?.slice(0, 100),
              url: /^https?:\/\//.test(c.req.query('url') ?? '')
                ? c.req.query('url')!.slice(0, 1500)
                : undefined,
              deadline: /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('deadline') ?? '')
                ? c.req.query('deadline')
                : undefined,
              roles: c.req.query('roles')?.slice(0, 300),
            },
          }}
        />
      </HomePage>,
    );
  });
  app.get('/works', (c) => {
    const { user } = requireUser(c, true);
    const works = store.works(user.id);
    const filter = z
      .enum(['all', 'draft', 'agent', 'published'])
      .catch('all')
      .parse(c.req.query('filter'));
    const view = z.enum(['list', 'grid']).catch('list').parse(c.req.query('view'));
    const proposals = Object.fromEntries(
      works.map((w) => [w.id, store.proposals(user.id, w.id).length]),
    );
    return c.html(
      <WorksPage user={user} works={works} proposals={proposals} filter={filter} view={view} />,
    );
  });
  app.get('/works/text', (c) => {
    const { user } = requireUser(c, true);
    const updated = c.req.query('updated');
    return c.html(
      <BulkTextPage
        user={user}
        works={store.works(user.id)}
        find={(c.req.query('find') ?? '').slice(0, 100)}
        replacement={(c.req.query('replace') ?? '').slice(0, 100)}
        result={
          updated === undefined
            ? undefined
            : { updated: Number(updated) || 0, conflicts: Number(c.req.query('conflicts')) || 0 }
        }
      />,
    );
  });
  app.post('/works/text', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody({ all: true });
    const find = z.string().min(1).max(100).parse(b.find),
      replacement = z
        .string()
        .max(100)
        .parse(b.replace ?? '');
    const ids = ([] as unknown[]).concat(b.work ?? []).map(String);
    let updated = 0,
      conflicts = 0;
    for (const id of ids) {
      const work = store.work(user.id, id);
      const base = z.coerce.number().int().positive().parse(b[`revision_${id}`]);
      const data = workSchema.parse(replaceAll(work.data, find, replacement));
      if (JSON.stringify(data) === JSON.stringify(work.data)) continue;
      try {
        store.updateWork(user.id, id, base, data);
        updated++;
      } catch (error) {
        if (error instanceof DomainError && error.status === 409) conflicts++;
        else throw error;
      }
    }
    return c.redirect(`/works/text?updated=${updated}&conflicts=${conflicts}`, 303);
  });
  app.get('/works/:id/console', (c) => {
    const { user } = requireUser(c, true);
    return c.html(
      <ConsolePage
        user={user}
        work={store.work(user.id, c.req.param('id'))}
        store={store}
        notice={
          c.req.query('saved')
            ? '保存しました。'
            : c.req.query('fixed')
              ? '表記を修正しました。'
              : undefined
        }
      />,
    );
  });
  app.post('/works/:id/console/fix', async (c) => {
    const { user } = requireUser(c, true),
      id = c.req.param('id'),
      work = store.work(user.id, id),
      b = await c.req.parseBody();
    const base = z.coerce.number().int().positive().parse(b.revision);
    const field = String(b.field ?? ''),
      rule = String(b.rule ?? '');
    if (rule !== 'all' && !isEditableField(field))
      throw new DomainError(422, '修正する項目を選んでください。');
    const data = workSchema.parse(
      rule === 'all'
        ? applyAllFixes(work.data)
        : applyFix(work.data, field as Parameters<typeof applyFix>[1], rule),
    );
    store.updateWork(user.id, id, base, data);
    return c.redirect(`/works/${id}/console?fixed=1`, 303);
  });
  app.get('/works/:id', (c) => {
    const { user } = requireUser(c, true);
    const work = store.work(user.id, c.req.param('id'));
    return c.html(
      <EditorPage
        user={user}
        work={work}
        store={store}
        proposals={store.proposals(user.id, work.id)}
      />,
    );
  });
  app.get('/works/:id/preview', (c) => {
    const { user } = requireUser(c, true);
    return c.html(
      <PreviewPage user={user} work={store.work(user.id, c.req.param('id'))} store={store} />,
    );
  });
  app.post('/works/:id/document', async (c) => {
    const { user } = requireUser(c, true),
      id = c.req.param('id'),
      body = z
        .object({ revision: z.number().int().positive(), data: z.unknown() })
        .parse(await c.req.json());
    const current = store.work(user.id, id);
    const input = workSchema.parse({
      ...(body.data as object),
      sources: current.data.sources,
      assessment: current.data.assessment,
    });
    const work = store.updateWork(
      user.id,
      id,
      body.revision,
      withLayout(input, input.layout ?? layoutOf(input)),
    );
    return c.json({ revision: work.revision });
  });
  app.post('/works/:id/assets', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    store.work(user.id, c.req.param('id'));
    const id = await upload(user.id, b.image as File, String(b.alt ?? '') || '作品の画像');
    return c.json({ id, url: `/assets/${id}`, alt: store.asset(id, user.id).alt }, 201);
  });
  app.get('/works/:id/form', (c) => {
    const { user } = requireUser(c, true);
    const work = store.work(user.id, c.req.param('id'));
    return c.html(
      <WorkEditor
        user={user}
        work={work}
        store={store}
        proposals={store.proposals(user.id, work.id)}
        notice={c.req.query('saved') ? '下書きを保存しました。' : undefined}
      />,
    );
  });
  app.post('/works/:id/save', async (c) => {
    const { user } = requireUser(c, true),
      id = c.req.param('id'),
      current = store.work(user.id, id),
      b = await c.req.parseBody();
    const list = (v: unknown) =>
      String(v ?? '')
        .split(/[,、\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    const data = workSchema.parse({
      ...current.data,
      ...Object.fromEntries(
        [
          'title',
          'summary',
          'kind',
          'status',
          'team_result',
          'my_contribution',
          'ingenuity',
          'outcome',
          'next_interest',
        ].map((k) => [k, b[k]]),
      ),
      year: b.year === '' ? null : Number(b.year),
      my_roles: list(b.my_roles),
      tags: list(b.tags),
    });
    store.updateWork(user.id, id, z.coerce.number().int().positive().parse(b.revision), data);
    return c.redirect(
      b.return === 'console' ? `/works/${id}/console?saved=1` : `/works/${id}/form?saved=1`,
      303,
    );
  });
  app.post('/works/:id/image', async (c) => {
    const { user } = requireUser(c, true),
      id = c.req.param('id'),
      work = store.work(user.id, id),
      b = await c.req.parseBody();
    const base = z.coerce.number().int().positive().parse(b.revision);
    if (base !== work.revision)
      throw new DomainError(409, '作品が更新されています。再読み込みしてください。');
    if (work.data.asset_ids.length >= 12)
      throw new DomainError(422, '画像は12枚まで追加できます。');
    const asset = await upload(user.id, b.image as File, String(b.alt ?? ''));
    store.updateWork(user.id, id, base, {
      ...work.data,
      asset_ids: [...work.data.asset_ids, asset],
    });
    return c.redirect(`/works/${id}?saved=1`, 303);
  });
  app.get('/works/:id/review', (c) => {
    const { user } = requireUser(c, true);
    return c.html(
      <ReviewPage user={user} work={store.work(user.id, c.req.param('id'))} store={store} />,
    );
  });
  app.post('/works/:id/publish', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    if (b.reviewed !== 'yes') throw new DomainError(422, '内容の確認にチェックを入れてください。');
    const input = publishSchema.parse({
      revision: Number(b.revision),
      share_to_feed: b.share_to_feed === 'yes',
    });
    const url = store.publish(user.id, c.req.param('id'), input.revision, input.share_to_feed);
    return c.redirect(url, 303);
  });
  app.post('/works/:id/withdraw', (c) => {
    const { user } = requireUser(c, true);
    store.withdraw(user.id, c.req.param('id'));
    return c.redirect(`/works/${c.req.param('id')}`, 303);
  });
  app.post('/works/:id/react', (c) => {
    const { user } = requireUser(c, true);
    social.shared(c.req.param('id'), user.id);
    store.react(user.id, c.req.param('id'));
    return c.redirect('/home', 303);
  });
  for (const action of ['accept', 'dismiss'])
    app.post(`/proposals/:id/${action}`, (c) => {
      const { user } = requireUser(c, true);
      const id = store.resolveProposal(user.id, c.req.param('id'), action === 'accept');
      return c.redirect(`/works/${id}`, 303);
    });
  const settingsPage = (
    c: Context<Env>,
    tab: SettingsTab,
    extra: { issued?: { token: string; expires: number }; notice?: string } = {},
  ) => {
    const { user } = requireUser(c, true);
    return c.html(
      <SettingsPage
        user={store.user(user.id)}
        tab={tab}
        profile={store.profileOf(user.id)}
        tokens={store.tokens(user.id)}
        origin={origin}
        {...extra}
      />,
    );
  };
  app.get('/settings', (c) => {
    const tab = c.req.query('tab');
    return settingsPage(c, tab === 'agent' || tab === 'account' ? tab : 'profile', {
      notice: c.req.query('saved') ? 'プロフィールを保存しました。' : undefined,
    });
  });
  app.get('/settings/agents', (c) => {
    requireUser(c, true);
    return c.redirect('/settings?tab=agent', 302);
  });
  app.post('/settings/profile', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody(),
      current = store.profileOf(user.id);
    const field = (key: string) => String(b[key] ?? '').trim();
    const name = z.string().trim().min(1).max(60).parse(b.display_name);
    const links = Array.from({ length: 6 }, (_, i) => ({
      label: field(`link_label_${i}`),
      url: field(`link_url_${i}`),
    })).filter((l) => l.label || l.url);
    const data = profileSchema.parse({
      bio: field('bio'),
      avatar_asset_id: b.remove_avatar === 'yes' ? null : current.avatar_asset_id,
      interests: parseRoles(b.interests).slice(0, 16),
      links,
    });
    const file = b.avatar;
    if (file instanceof File && file.size > 0)
      data.avatar_asset_id = await upload(user.id, file, `${name}のアイコン`);
    store.db.transaction(() => {
      store.updateProfile(user.id, data);
      store.updateDisplayName(user.id, name);
    })();
    return c.redirect('/settings?saved=1', 303);
  });
  app.post('/settings/agents/tokens', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody(),
      label = z.string().trim().min(1).max(80).parse(b.label);
    return settingsPage(c, 'agent', { issued: store.createToken(user.id, label) });
  });
  app.post('/settings/agents/tokens/:id/revoke', (c) => {
    const { user } = requireUser(c, true);
    store.revoke(user.id, c.req.param('id'));
    return c.redirect('/settings?tab=agent', 303);
  });
  remoteRoutes(app, store, { origin, skillPath: options.skillPath });
  app.get('/downloads/kosen-portfolio-skill.md', async (c) => {
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="SKILL.md"');
    return c.body(await Bun.file(options.skillPath).text());
  });
  app.get('/u/:handle', (c) => {
    const person = store.publicUser(c.req.param('handle'));
    if (!person) throw new DomainError(404, '公開ページが見つかりません。');
    const identity = c.get('identity');
    return c.html(
      <ProfilePage
        person={person}
        profile={store.profileOf(person.id)}
        viewer={identity?.mode === 'session' ? identity.user : undefined}
        works={store.published(person.handle)}
        timeline={timeline}
        tab={c.req.query('tab') === 'posts' ? 'posts' : 'works'}
        year={c.req.query('year')}
        tag={c.req.query('tag')}
      />,
    );
  });
  app.get('/u/:handle/works/:id', (c) => {
    const work = store
      .published(c.req.param('handle'))
      .find((w) => w.work_id === c.req.param('id'));
    if (!work) throw new DomainError(404, '公開された作品が見つかりません。');
    return c.html(
      <PublicWorkPage
        work={work}
        store={store}
        viewer={c.get('identity')?.mode === 'session' ? c.get('identity')?.user : undefined}
      >
        <Conversation
          work={work}
          user={c.get('identity')?.mode === 'session' ? c.get('identity')?.user : undefined}
          social={social}
        />
      </PublicWorkPage>,
    );
  });
  app.get('/connections', (c) => {
    const { user } = requireUser(c, true);
    const handle = c.req.query('with');
    const found = handle ? store.publicUser(handle) : null;
    const person =
      found && found.id !== user.id && !social.blocked(user.id, found.id)
        ? timeline.person(found.id)
        : undefined;
    if (person) social.readFrom(user.id, person.id);
    return c.html(
      <ConnectionsPage
        user={user}
        social={social}
        timeline={timeline}
        tab={c.req.query('tab') === 'notifications' ? 'notifications' : 'messages'}
        person={person}
        notice={
          c.req.query('reported')
            ? '通報を記録して自分の画面で非表示にしました。'
            : c.req.query('saved')
              ? '保存しました。'
              : undefined
        }
      />,
    );
  });
  const messagesBack = (value: unknown) =>
    /^\/(connections|home)(\?[A-Za-z0-9=&%_.-]*)?$/.test(String(value)) ? String(value) : null;
  app.post('/social/questions', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    social.ask(user.id, String(b.work_id ?? ''), String(b.body ?? ''));
    return c.redirect(messagesBack(b.back) ?? '/connections', 303);
  });
  app.post('/social/works/:id/questions', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody(),
      id = c.req.param('id');
    social.ask(user.id, id, String(b.body ?? ''));
    return c.redirect(`/u/${social.shared(id, user.id).handle}/works/${id}#conversation`, 303);
  });
  app.post('/social/questions/:id/answer', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    const id = social.answer(user.id, c.req.param('id'), String(b.answer ?? ''));
    return c.redirect(
      messagesBack(b.back) ?? `/u/${social.shared(id, user.id).handle}/works/${id}#conversation`,
      303,
    );
  });
  app.post('/social/questions/:id/delete', (c) => {
    social.removeQuestion(requireUser(c, true).user.id, c.req.param('id'));
    return c.redirect('/connections', 303);
  });
  app.post('/social/questions/:id/report', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    social.report(user.id, c.req.param('id'), String(b.reason ?? ''));
    return c.redirect('/connections?reported=1', 303);
  });
  app.post('/social/works/:id/invitations', async (c) => {
    const { user } = requireUser(c, true);
    social.invite(user.id, c.req.param('id'), invitationSchema.parse(await c.req.parseBody()));
    return c.redirect('/connections?saved=1', 303);
  });
  app.post('/social/invitations/:id/state', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    social.decide(
      user.id,
      c.req.param('id'),
      z.enum(['accepted', 'declined', 'cancelled']).parse(b.state),
    );
    return c.redirect(messagesBack(b.back) ?? '/connections?saved=1', 303);
  });
  app.post('/social/invitations/:id/contact', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    social.contact(user.id, c.req.param('id'), String(b.contact ?? ''));
    return c.redirect(messagesBack(b.back) ?? '/connections?saved=1', 303);
  });
  app.post('/social/blocks/:id', (c) => {
    social.block(requireUser(c, true).user.id, c.req.param('id'));
    return c.redirect('/connections', 303);
  });
  app.post('/social/blocks/:id/remove', (c) => {
    social.unblock(requireUser(c, true).user.id, c.req.param('id'));
    return c.redirect('/connections', 303);
  });
  app.post('/social/notices/read', (c) => {
    social.read(requireUser(c, true).user.id);
    return c.redirect('/connections', 303);
  });
  const backTo = (value: unknown) =>
    /^\/(home|timeline\/[0-9a-f-]{36}|u\/[a-z][a-z0-9-]{2,29})(\?[A-Za-z0-9=&%_.-]*)?$/.test(
      String(value),
    )
      ? String(value)
      : '/home';
  app.post('/timeline/posts', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    const blank = (v: unknown) => String(v ?? '').trim() || undefined;
    if (b.kind === 'recruit')
      timeline.recruit(user.id, {
        title: b.title,
        body: b.body,
        roles: parseRoles(b.roles),
        url: blank(b.url),
        deadline: blank(b.deadline),
      });
    else timeline.progress(user.id, { body: b.body, work_id: blank(b.work_id) });
    return c.redirect('/home', 303);
  });
  app.get('/timeline/:id', (c) => {
    const { user } = requireUser(c, true);
    return c.html(
      <TimelinePostPage
        user={user}
        timeline={timeline}
        id={c.req.param('id')}
        works={store.works(user.id)}
      />,
    );
  });
  app.post('/timeline/:id/replies', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody(),
      id = c.req.param('id');
    timeline.reply(user.id, id, b.body);
    return c.redirect(`/timeline/${id}#replies`, 303);
  });
  app.post('/timeline/:id/like', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    timeline.like(user.id, c.req.param('id'));
    return c.redirect(backTo(b.back), 303);
  });
  app.post('/timeline/:id/delete', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody(),
      parent = timeline.remove(user.id, c.req.param('id'));
    return c.redirect(parent ? `/timeline/${parent}#replies` : backTo(b.back), 303);
  });
  app.post('/timeline/:id/report', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    timeline.report(user.id, c.req.param('id'), String(b.reason ?? ''));
    return c.redirect(backTo(b.back), 303);
  });
  app.post('/timeline/:id/joins', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody(),
      id = c.req.param('id');
    timeline.join(user.id, id, {
      role: b.role,
      message: b.message,
      work_id: String(b.work_id ?? '').trim() || undefined,
    });
    return c.redirect(`/timeline/${id}#joins`, 303);
  });
  app.post('/timeline/joins/:id/state', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    const post = timeline.decide(
      user.id,
      c.req.param('id'),
      z.enum(['accepted', 'declined', 'cancelled']).parse(b.state),
    );
    return c.redirect(messagesBack(b.back) ?? `/timeline/${post}#joins`, 303);
  });
  app.post('/timeline/joins/:id/contact', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    const post = timeline.contact(user.id, c.req.param('id'), String(b.contact ?? ''));
    return c.redirect(messagesBack(b.back) ?? `/timeline/${post}#joins`, 303);
  });
  app.get('/opportunities', (c) => {
    const { user } = requireUser(c, true);
    const tab = c.req.query('tab');
    discovery.ensure(user.id);
    options.previews?.ensure([
      ...opportunities.suggestions(user.id).map((s) => s.url),
      ...opportunities.list(user.id).map((o) => o.url),
    ]);
    return c.html(
      <EventsPage
        user={user}
        tab={(['saved', 'plans'].includes(tab ?? '') ? tab : 'foryou') as EventsTab}
        opportunities={opportunities}
        previews={options.previews}
        status={{
          enabled: discovery.enabled(),
          running: discovery.running(user.id),
          last: discovery.last(user.id),
        }}
      />,
    );
  });
  app.post('/opportunities/suggestions/:id/save', (c) => {
    const { user } = requireUser(c, true);
    return c.redirect(
      `/opportunities/${opportunities.saveSuggestion(user.id, c.req.param('id'))}`,
      303,
    );
  });
  app.post('/opportunities/suggestions/:id/dismiss', (c) => {
    const { user } = requireUser(c, true);
    opportunities.dismissSuggestion(user.id, c.req.param('id'));
    return c.redirect('/opportunities', 303);
  });
  app.post('/opportunities', async (c) => {
    const { user } = requireUser(c, true),
      id = opportunities.add(user.id, opportunitySchema.parse(await c.req.parseBody()));
    return c.redirect(`/opportunities/${id}`, 303);
  });
  app.get('/opportunities/:id', (c) => {
    const { user } = requireUser(c, true);
    options.previews?.ensure([opportunities.get(user.id, c.req.param('id')).url]);
    return c.html(
      <OpportunityPage
        adviceId={c.req.query('advice')}
        user={user}
        id={c.req.param('id')}
        opportunities={opportunities}
        previews={options.previews}
        works={store.works(user.id)}
        shared={opportunities.sharesInterest(user.id, c.req.param('id'))}
        peers={opportunities
          .interestedPeers(user.id, c.req.param('id'))
          .filter((id) => !social.blocked(user.id, id))
          .map((id) => {
            const peer = store.user(id);
            const works = store.published(peer.handle);
            const shared = works.find((w) => w.share_to_feed);
            return {
              id,
              display_name: peer.display_name,
              handle: peer.handle,
              avatar: store.avatarOf(id),
              roles: [...new Set(works.flatMap((w) => w.data.my_roles))].slice(0, 4),
              work: shared ? { id: shared.work_id, title: shared.data.title } : null,
            };
          })}
      />,
    );
  });
  app.post('/opportunities/:id/share', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    opportunities.shareInterest(user.id, c.req.param('id'), b.share === 'yes');
    return c.redirect(`/opportunities/${c.req.param('id')}#people`, 303);
  });
  app.post('/opportunities/:id/edit', async (c) => {
    const { user } = requireUser(c, true),
      id = c.req.param('id');
    opportunities.edit(user.id, id, opportunitySchema.parse(await c.req.parseBody()));
    return c.redirect(`/opportunities/${id}`, 303);
  });
  app.post('/opportunities/:id/state', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody(),
      id = c.req.param('id');
    opportunities.setState(user.id, id, planState.parse(b.state));
    return c.redirect(`/opportunities/${id}`, 303);
  });
  app.post('/opportunities/:id/recommend', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody({ all: true }),
      id = c.req.param('id');
    const ids = Array.isArray(b.work_ids) ? b.work_ids : [b.work_ids];
    const advice = await opportunities.recommend(user.id, id, z.array(z.string()).parse(ids));
    return c.redirect(`/opportunities/${id}?advice=${advice}`, 303);
  });
  app.get('/event-previews/:id', async (c) => {
    const { user } = requireUser(c, true);
    const image = options.previews?.imageFor(user.id, c.req.param('id'));
    if (!image) throw new DomainError(404, '画像が見つかりません。');
    const file = Bun.file(image.path);
    if (!(await file.exists())) throw new DomainError(404, '画像が見つかりません。');
    c.header('Content-Type', image.mime);
    c.header('Cache-Control', 'private, max-age=86400');
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return c.body(await file.arrayBuffer());
  });
  app.get('/assets/:id', async (c) => {
    const asset = store.asset(c.req.param('id'), c.get('identity')?.user.id);
    c.header('Content-Type', asset.mime);
    return c.body(await Bun.file(asset.path).arrayBuffer());
  });

  app.post('/v1/register', async (c) => {
    const { invite_code, ...body } = (await c.req.json()) as Record<string, unknown>;
    checkInvite(invite_code);
    const input = registrationSchema.parse(body);
    throttle(input.email);
    const user = await store.register(input);
    authenticate(c, user.id);
    return c.json({ user, portfolio_url: `${origin}/u/${user.handle}` }, 201);
  });
  app.post('/v1/login', async (c) => {
    const input = z
      .object({ email: z.email().max(254), password: z.string().max(128) })
      .parse(await c.req.json());
    throttle(input.email);
    const user = await store.login(input.email, input.password);
    authenticate(c, user.id);
    return c.json({ user });
  });
  app.get('/v1/me', (c) => c.json({ user: requireUser(c).user }));
  app.get('/v1/authoring-rules', (c) => {
    requireUser(c);
    return c.json(authoringRules);
  });
  app.post('/v1/tokens', async (c) => {
    const { user } = requireUser(c, true);
    const { label } = z
      .object({ label: z.string().trim().min(1).max(80) })
      .parse(await c.req.json());
    return c.json(store.createToken(user.id, label), 201);
  });
  app.delete('/v1/tokens/:id', (c) => {
    const { user } = requireUser(c, true);
    store.revoke(user.id, c.req.param('id'));
    return c.json({ revoked: true });
  });
  app.get('/v1/works', (c) => {
    const { user } = requireUser(c);
    return c.json({ works: store.works(user.id) });
  });
  app.post('/v1/works', async (c) => {
    const { user } = requireUser(c),
      input = createWorkSchema.parse(await c.req.json()),
      result = store.createWork(user.id, input.source_key, input.work);
    return c.json(
      { ...result, preview_url: `${origin}/works/${result.work.id}` },
      result.created ? 201 : 200,
    );
  });
  app.get('/v1/works/:id', (c) => {
    const { user } = requireUser(c);
    return c.json({
      work: store.work(user.id, c.req.param('id')),
      preview_url: `${origin}/works/${c.req.param('id')}`,
    });
  });
  app.put('/v1/works/:id', async (c) => {
    const { user } = requireUser(c, true),
      input = updateWorkSchema.parse(await c.req.json());
    return c.json({
      work: store.updateWork(user.id, c.req.param('id'), input.base_revision, input.work),
    });
  });
  app.post('/v1/works/:id/proposals', async (c) => {
    const { user } = requireUser(c),
      input = updateWorkSchema.parse(await c.req.json());
    return c.json(store.propose(user.id, c.req.param('id'), input.base_revision, input.work), 201);
  });
  app.post('/v1/works/:id/publication-reviews', (c) => {
    const { user } = requireUser(c),
      work = store.work(user.id, c.req.param('id'));
    return c.json({ revision: work.revision, review_url: `${origin}/works/${work.id}/review` });
  });
  app.post('/v1/works/:id/publication', async (c) => {
    const { user } = requireUser(c, true),
      input = publishSchema.parse(await c.req.json());
    return c.json({
      url: origin + store.publish(user.id, c.req.param('id'), input.revision, input.share_to_feed),
    });
  });
  app.delete('/v1/works/:id/publication', (c) => {
    const { user } = requireUser(c, true);
    store.withdraw(user.id, c.req.param('id'));
    return c.json({ withdrawn: true });
  });
  app.post('/v1/assets', async (c) => {
    const { user } = requireUser(c),
      b = await c.req.parseBody();
    const id = await upload(user.id, b.image as File, String(b.alt ?? ''));
    return c.json({ asset_id: id, url: `${origin}/assets/${id}` }, 201);
  });
  app.notFound((c) =>
    c.html(
      <ErrorPage
        message="ページが見つかりません。URLを確認してください。"
        user={c.get('identity')?.user}
      />,
      404,
    ),
  );
  return app;
}
