/// <reference lib="dom" />
// Browser runtime: dot field, Meniscus liquid glass, and the header menu.
// The dot canvas is the optical source that every glass surface refracts.
import { GlassRenderer, MAX_PANES, parseColor, resolveGlass } from './meniscus';

const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const reducedTransparency = matchMedia(
  '(prefers-reduced-transparency: reduce), (prefers-contrast: more)',
);
const background = () => getComputedStyle(root).getPropertyValue('--bg').trim() || '#ffffff';

/* ---------- dot field ---------- */

type Dot = {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  vx: number;
  vy: number;
  opacity: number;
  phase: number;
  breath: number;
};

function startDotField() {
  const layer = document.createElement('div');
  layer.className = 'dot-layer';
  layer.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.dataset.liquidSource = 'dots';
  layer.append(canvas);
  document.body.prepend(layer);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  root.classList.add('has-dot-field');
  let dots: Dot[] = [];
  let tick = 0;
  let raf = 0;
  const pointer = { x: -1000, y: -1000 };
  const dotRgb = '15, 23, 42';

  const resize = () => {
    const ratio = devicePixelRatio || 1;
    canvas.width = innerWidth * ratio;
    canvas.height = innerHeight * ratio;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const spacing = 32;
    dots = [];
    for (let i = 0; i < Math.ceil(innerWidth / spacing); i++)
      for (let j = 0; j < Math.ceil(innerHeight / spacing); j++) {
        const x = i * spacing + spacing / 2;
        const y = j * spacing + spacing / 2;
        dots.push({
          x,
          y,
          baseX: x,
          baseY: y,
          vx: 0,
          vy: 0,
          opacity: 0.1 + Math.random() * 0.05,
          phase: Math.random() * Math.PI * 2,
          breath: 0.003 + Math.random() * 0.004,
        });
      }
  };

  const frame = () => {
    raf = 0;
    if (document.hidden) return;
    const fill = background();
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    const time = ++tick;
    const still = reducedMotion.matches;
    const { x: mx, y: my } = pointer;
    for (const d of dots) {
      const waveX = still ? 0 : Math.sin(time * 0.001 + d.baseX * 0.002 + d.baseY * 0.001) * 4;
      const waveY = still ? 0 : Math.cos(time * 0.0008 + d.baseY * 0.003 + d.baseX * 0.0005) * 3;
      const breathX = still ? 0 : Math.sin(time * d.breath + d.phase) * 2;
      const breathY = still ? 0 : Math.cos(time * d.breath * 0.7 + d.phase) * 2;
      const dx = mx - d.x;
      const dy = my - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 300) {
        const force = (1 - dist / 300) ** 2 * 6;
        const angle = Math.atan2(dy, dx);
        d.vx -= Math.cos(angle) * force * 0.006;
        d.vy -= Math.sin(angle) * force * 0.006;
      }
      d.vx += (d.baseX + breathX + waveX - d.x) * 0.015;
      d.vy += (d.baseY + breathY + waveY - d.y) * 0.015;
      d.vx *= 0.95;
      d.vy *= 0.95;
      d.x += d.vx;
      d.y += d.vy;
      const near = Math.hypot(mx - d.x, my - d.y);
      const boost = near < 250 ? (1 - near / 250) * 0.25 : 0;
      const moved = Math.hypot(d.x - d.baseX, d.y - d.baseY);
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1 + boost * 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${dotRgb}, ${Math.min(d.opacity + moved * 0.005 + boost, 0.45)})`;
      ctx.fill();
    }
    ctx.lineWidth = 0.4;
    const nearby = dots
      .map((d) => ({ d, distance: Math.hypot(mx - d.x, my - d.y) }))
      .filter((n) => n.distance <= 220);
    for (let i = 0; i < nearby.length; i++)
      for (let j = i + 1; j < nearby.length; j++) {
        const a = nearby[i];
        const b = nearby[j];
        const gap = Math.hypot(a.d.x - b.d.x, a.d.y - b.d.y);
        if (gap >= 50) continue;
        const alpha = (1 - gap / 50) * (1 - Math.max(a.distance, b.distance) / 220) * 0.15;
        ctx.beginPath();
        ctx.moveTo(a.d.x, a.d.y);
        ctx.lineTo(b.d.x, b.d.y);
        ctx.strokeStyle = `rgba(${dotRgb}, ${alpha})`;
        ctx.stroke();
      }
    raf = requestAnimationFrame(frame);
  };
  const resume = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    if (!document.hidden) raf = requestAnimationFrame(frame);
  };
  addEventListener('resize', () => {
    resize();
    resume();
  });
  window.addEventListener('mousemove', (event: MouseEvent) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });
  document.addEventListener('mouseleave', () => {
    pointer.x = -1000;
    pointer.y = -1000;
  });
  document.addEventListener('visibilitychange', resume);
  resize();
  resume();
}

/* ---------- liquid glass ---------- */

type GlassOptions = {
  radius?: number;
  blur?: number;
  refraction?: number;
  bezel?: number;
  frost?: number;
};
type Surface = {
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  options: GlassOptions;
  visible: boolean;
  light: number;
  target: number;
  angle: number;
  targetAngle: number;
};

const surfaces = new Map<HTMLElement, Surface>();
let renderer: GlassRenderer | undefined;
let buffer: HTMLCanvasElement | undefined;
let glassFrame = 0;
let lastDraw = 0;
let failed = false;
let tint: [number, number, number, number] = [1, 1, 1, 1];
const visibility = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const surface = surfaces.get(entry.target as HTMLElement);
    if (surface) surface.visible = entry.isIntersecting;
  }
  scheduleGlass();
});

function scheduleGlass() {
  if (!glassFrame && surfaces.size && !document.hidden && !failed)
    glassFrame = requestAnimationFrame(drawGlass);
}
const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function drawGlass(time: number) {
  glassFrame = 0;
  if (document.hidden || failed || !surfaces.size) return;
  if (reducedTransparency.matches) {
    for (const { element } of surfaces.values()) element.dataset.opticalPath = 'frost';
    return;
  }
  scheduleGlass();
  if (time - lastDraw < 1000 / 30) return;
  lastDraw = time;
  const source = document.querySelector<HTMLCanvasElement>('canvas[data-liquid-source]');
  if (!source?.width) return;
  const ratio = Math.min(devicePixelRatio || 1, 1.5);
  type Item = { surface: Surface; box: DOMRect; glass: ReturnType<typeof resolveGlass> };
  const passes: Item[][] = [];
  for (const surface of surfaces.values()) {
    const { element, options } = surface;
    if (!surface.visible || !element.isConnected) continue;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || box.bottom < 0 || box.top > innerHeight) continue;
    surface.light += (surface.target - surface.light) * 0.18;
    surface.angle += (surface.targetAngle - surface.angle) * 0.16;
    const radius =
      options.radius ??
      Math.min(parseFloat(getComputedStyle(element).borderTopLeftRadius) || 16, box.height / 2);
    const glass = resolveGlass(
      {
        variant: 'clear',
        radius,
        bezel: options.bezel ?? Math.min(20, box.height / 3),
        refraction: (options.refraction ?? 90) / 90,
        blur: options.blur ?? 0.5,
        saturation: 1.05,
        specular: surface.light * 0.48,
        rim: 0.09 + surface.light * 0.18,
        shade: 0.1,
        lightAngle: surface.angle,
        lightElevation: 28,
      },
      box.width,
      box.height,
    );
    const item = { surface, box, glass };
    const pass = passes.find(
      (p) => p.length < MAX_PANES && p.every((other) => !overlaps(other.box, box)),
    );
    if (pass) pass.push(item);
    else passes.push([item]);
  }
  if (!passes.length) return;
  try {
    buffer ??= document.createElement('canvas');
    const width = Math.round(innerWidth * ratio);
    const height = Math.round(innerHeight * ratio);
    if (buffer.width !== width || buffer.height !== height) {
      buffer.width = width;
      buffer.height = height;
    }
    renderer ??= new GlassRenderer(buffer);
    renderer.setSource(source, source.width, source.height);
    for (const pass of passes) {
      renderer.render(
        pass.map(({ surface, box, glass }) => ({
          x: box.left,
          y: box.top,
          glass,
          tint: [tint[0], tint[1], tint[2], surface.options.frost ?? 0.04] as [
            number,
            number,
            number,
            number,
          ],
        })),
        { x: 0, y: 0, width: innerWidth, height: innerHeight },
        ratio,
        { panesOnly: true },
      );
      for (const { surface, box } of pass) {
        const { canvas, context, element } = surface;
        const w = Math.round(element.offsetWidth * ratio);
        const h = Math.round(element.offsetHeight * ratio);
        if (!w || !h) continue;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        context.clearRect(0, 0, w, h);
        context.drawImage(
          buffer,
          box.left * ratio,
          box.top * ratio,
          box.width * ratio,
          box.height * ratio,
          0,
          0,
          w,
          h,
        );
        element.dataset.opticalPath = 'webgl';
      }
    }
  } catch {
    failed = true;
    renderer?.dispose();
    renderer = undefined;
    for (const { element } of surfaces.values()) element.dataset.opticalPath = 'frost';
  }
}

function registerGlass(element: HTMLElement) {
  if (surfaces.has(element)) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'glass-optics';
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (!context) return;
  element.prepend(canvas);
  const options: GlassOptions = {};
  for (const key of ['radius', 'blur', 'refraction', 'bezel', 'frost'] as const) {
    const value = element.dataset[`glass${key[0].toUpperCase()}${key.slice(1)}`];
    if (value !== undefined && Number.isFinite(Number(value))) options[key] = Number(value);
  }
  const surface: Surface = {
    element,
    canvas,
    context,
    options,
    visible: true,
    light: 0,
    target: 0,
    angle: -45,
    targetAngle: -45,
  };
  element.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || reducedMotion.matches) return;
    const box = element.getBoundingClientRect();
    surface.targetAngle =
      (Math.atan2(
        event.clientX - box.left - box.width / 2,
        -(event.clientY - box.top - box.height / 2),
      ) *
        180) /
      Math.PI;
    surface.target = 1;
  });
  element.addEventListener('pointerleave', () => (surface.target = 0));
  surfaces.set(element, surface);
  visibility.observe(element);
  element.dataset.opticalPath = 'frost';
}

function startGlass() {
  tint = parseColor(background()) ?? [1, 1, 1, 1];
  const scan = () => {
    for (const element of document.querySelectorAll<HTMLElement>(
      '[data-glass], .glass, .card, .status-strip, .tl-composer, .btn-outline, .ui-action-plain',
    ))
      registerGlass(element);
    for (const [element, surface] of surfaces)
      if (!element.isConnected) {
        visibility.unobserve(element);
        surface.canvas.remove();
        surfaces.delete(element);
      }
    scheduleGlass();
  };
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', scheduleGlass);
  addEventListener('scroll', scheduleGlass, { passive: true });
}

/* ---------- header menu ---------- */

function startMenu() {
  const menu = document.querySelector<HTMLElement>('[data-site-menu]');
  const trigger = menu?.querySelector<HTMLButtonElement>('[data-menu-trigger]');
  const links = menu?.querySelector<HTMLElement>('[data-menu-links]');
  if (!menu || !trigger || !links) return;
  const mobile = matchMedia('(max-width: 640px)');
  let hover = false;
  let pinned = false;
  let savedOverflow = '';
  const render = () => {
    const open = hover || pinned;
    menu.classList.toggle('is-open', open);
    links.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    trigger.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニュー');
    const full = open && mobile.matches;
    if (full) {
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-modal', 'true');
      if (root.dataset.navigationOpen !== 'true') {
        savedOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        root.dataset.navigationOpen = 'true';
        requestAnimationFrame(() => links.querySelector('a')?.focus());
      }
    } else {
      menu.removeAttribute('role');
      menu.removeAttribute('aria-modal');
      if (root.dataset.navigationOpen === 'true') {
        document.body.style.overflow = savedOverflow;
        delete root.dataset.navigationOpen;
      }
    }
    scheduleGlass();
  };
  const close = () => {
    hover = false;
    pinned = false;
    render();
  };
  trigger.addEventListener('click', () => {
    pinned = !pinned;
    hover = false;
    render();
  });
  menu.addEventListener('pointerenter', (event) => {
    if (!mobile.matches && event.pointerType === 'mouse' && matchMedia('(hover: hover)').matches) {
      hover = true;
      render();
    }
  });
  menu.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && !menu.contains(document.activeElement)) close();
  });
  menu.addEventListener('focusout', (event) => {
    if (event.relatedTarget && !menu.contains(event.relatedTarget as Node)) close();
  });
  document.addEventListener('pointerdown', (event) => {
    if (menu.classList.contains('is-open') && !menu.contains(event.target as Node)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (!menu.classList.contains('is-open')) return;
    if (event.key === 'Escape') {
      close();
      trigger.focus();
    } else if (event.key === 'Tab' && mobile.matches) {
      const controls = [...menu.querySelectorAll<HTMLElement>('a,button')].filter(
        (c) => c.offsetParent,
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  mobile.addEventListener('change', close);
}

startDotField();
startGlass();
startMenu();
