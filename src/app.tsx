import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Store, DomainError, type Identity } from './store';
import { SocialStore, invitationSchema } from './social';
import { TimelineStore, parseRoles } from './timeline';
import { Timeline, TimelinePostPage } from './timeline-ui';
import { Opportunities, opportunitySchema, planState, type ClaudeOptions } from './opportunities';
import { Conversation, ConnectionsPage, OpportunitiesPage, OpportunityPage } from './social-ui';
import {
  registrationSchema,
  createWorkSchema,
  updateWorkSchema,
  publishSchema,
  workSchema,
  authoringRules,
} from './schema';
import {
  AuthPage,
  HomePage,
  WorksPage,
  WorkEditor,
  ReviewPage,
  ConnectPage,
  PublicPortfolio,
  PublicWorkPage,
  ErrorPage,
} from './ui';

type Env = { Variables: { identity: Identity | null } };
type Options = {
  origin: string;
  assetDirectory: string;
  staticDirectory: string;
  skillPath: string;
  claude?: ClaudeOptions;
};
export function createApp(store: Store, options: Options) {
  const app = new Hono<Env>();
  const social = new SocialStore(store);
  const timeline = new TimelineStore(store, social);
  const opportunities = new Opportunities(store, options.claude);
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
      c.req.header('Origin') !== origin
    )
      throw new DomainError(403, 'この画面からもう一度操作してください。');
    await next();
  });
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
          ? '入力内容を確認してください。必須項目と文字数を見直してください。'
          : '処理を完了できませんでした。時間をおいてもう一度試してください。';
    if (status === 500)
      console.error('Request failed:', error instanceof Error ? error.name : 'unknown');
    if (c.req.path.startsWith('/v1/'))
      return c.json({ error: message }, status as ContentfulStatusCode);
    if (c.req.path === '/register' || c.req.path === '/login')
      return c.html(
        <AuthPage register={c.req.path === '/register'} error={message} />,
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
  app.get('/', (c) => (c.get('identity') ? c.redirect('/home') : c.redirect('/register')));
  app.get('/register', (c) => c.html(<AuthPage register />));
  app.get('/login', (c) => c.html(<AuthPage />));
  app.post('/register', async (c) => {
    const input = registrationSchema.parse(await c.req.parseBody());
    throttle(input.email);
    const user = await store.register(input);
    authenticate(c, user.id);
    return c.redirect('/settings/agents', 303);
  });
  app.post('/login', async (c) => {
    const body = z
      .object({ email: z.email().max(254), password: z.string().max(128) })
      .parse(await c.req.parseBody());
    throttle(body.email);
    const user = await store.login(body.email, body.password);
    authenticate(c, user.id);
    return c.redirect('/home', 303);
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
    return c.html(
      <HomePage user={user} works={store.works(user.id)}>
        <Timeline
          user={user}
          timeline={timeline}
          works={store.works(user.id)}
          unread={social.notices(user.id).filter((n) => !n.read).length}
          view={{
            filter: c.req.query('filter') === 'recruit' ? 'recruit' : 'all',
            role,
            compose: c.req.query('compose') === 'recruit' ? 'recruit' : 'progress',
          }}
        />
      </HomePage>,
    );
  });
  app.get('/works', (c) => {
    const { user } = requireUser(c, true);
    return c.html(<WorksPage user={user} works={store.works(user.id)} />);
  });
  app.get('/works/:id', (c) => {
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
    return c.redirect(`/works/${id}?saved=1`, 303);
  });
  app.post('/works/:id/image', async (c) => {
    const { user } = requireUser(c, true),
      id = c.req.param('id'),
      work = store.work(user.id, id),
      b = await c.req.parseBody();
    const base = z.coerce.number().int().positive().parse(b.revision);
    if (base !== work.revision)
      throw new DomainError(409, '作品が更新されています。再読み込みしてください。');
    if (work.data.asset_ids.length >= 8) throw new DomainError(422, '画像は8枚まで追加できます。');
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
  app.get('/settings/agents', (c) => {
    const { user } = requireUser(c, true);
    return c.html(<ConnectPage user={user} tokens={store.tokens(user.id)} origin={origin} />);
  });
  app.post('/settings/agents/tokens', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody(),
      label = z.string().trim().min(1).max(80).parse(b.label);
    const issued = store.createToken(user.id, label);
    return c.html(
      <ConnectPage user={user} tokens={store.tokens(user.id)} issued={issued} origin={origin} />,
    );
  });
  app.post('/settings/agents/tokens/:id/revoke', (c) => {
    const { user } = requireUser(c, true);
    store.revoke(user.id, c.req.param('id'));
    return c.redirect('/settings/agents', 303);
  });
  app.get('/downloads/kosen-portfolio-skill.md', async (c) => {
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="SKILL.md"');
    return c.body(await Bun.file(options.skillPath).text());
  });
  app.get('/u/:handle', (c) => {
    const profile = store.profile(c.req.param('handle'));
    if (!profile) throw new DomainError(404, '公開ページが見つかりません。');
    return c.html(
      <PublicPortfolio
        profile={profile}
        works={store.published(profile.handle)}
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
    return c.html(
      <ConnectionsPage
        user={user}
        social={social}
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
    return c.redirect(`/u/${social.shared(id, user.id).handle}/works/${id}#conversation`, 303);
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
    return c.redirect('/connections?saved=1', 303);
  });
  app.post('/social/invitations/:id/contact', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    social.contact(user.id, c.req.param('id'), String(b.contact ?? ''));
    return c.redirect('/connections?saved=1', 303);
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
    /^\/(home|timeline\/[0-9a-f-]{36})(\?[A-Za-z0-9=&%_.-]*)?$/.test(String(value))
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
    return c.redirect(`/timeline/${post}#joins`, 303);
  });
  app.post('/timeline/joins/:id/contact', async (c) => {
    const { user } = requireUser(c, true),
      b = await c.req.parseBody();
    const post = timeline.contact(user.id, c.req.param('id'), String(b.contact ?? ''));
    return c.redirect(`/timeline/${post}#joins`, 303);
  });
  app.get('/opportunities', (c) => {
    const { user } = requireUser(c, true);
    return c.html(
      <OpportunitiesPage user={user} opportunities={opportunities} works={store.works(user.id)} />,
    );
  });
  app.post('/opportunities', async (c) => {
    const { user } = requireUser(c, true),
      id = opportunities.add(user.id, opportunitySchema.parse(await c.req.parseBody()));
    return c.redirect(`/opportunities/${id}`, 303);
  });
  app.get('/opportunities/:id', (c) => {
    const { user } = requireUser(c, true);
    return c.html(
      <OpportunityPage
        adviceId={c.req.query('advice')}
        user={user}
        id={c.req.param('id')}
        opportunities={opportunities}
        works={store.works(user.id)}
      />,
    );
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
  app.get('/assets/:id', async (c) => {
    const asset = store.asset(c.req.param('id'), c.get('identity')?.user.id);
    c.header('Content-Type', asset.mime);
    return c.body(await Bun.file(asset.path).arrayBuffer());
  });

  app.post('/v1/register', async (c) => {
    const input = registrationSchema.parse(await c.req.json());
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
