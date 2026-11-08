document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const source = document.getElementById(button.dataset.copy);
  try {
    await navigator.clipboard.writeText(source.value);
    button.textContent = 'コピーしました';
  } catch {
    source.focus();
    source.select();
    button.textContent = '選択した内容をコピーしてください';
  }
});

// Dot field: a 32px grid of breathing dots that eases away from the pointer.
// Glass surfaces blur this canvas, so it is the optical source for the material.
(() => {
  const canvas = document.createElement('canvas');
  canvas.className = 'dot-field';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  document.body.prepend(canvas);
  document.documentElement.classList.add('has-dot-field');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointer = { x: -1000, y: -1000 };
  let dots = [];
  let width = 0;
  let height = 0;
  let frame = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = innerWidth;
    height = innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dots = [];
    for (let x = 16; x < width + 32; x += 32)
      for (let y = 16; y < height + 32; y += 32)
        dots.push({ x, y, ox: 0, oy: 0, phase: Math.random() * Math.PI * 2 });
  };
  const draw = (time) => {
    ctx.clearRect(0, 0, width, height);
    for (const d of dots) {
      const dx = d.x - pointer.x;
      const dy = d.y - pointer.y;
      const dist = Math.hypot(dx, dy);
      const push = dist < 140 ? (1 - dist / 140) * 14 : 0;
      d.ox += ((dist ? (dx / dist) * push : 0) - d.ox) * 0.12;
      d.oy += ((dist ? (dy / dist) * push : 0) - d.oy) * 0.12;
      const breath = still ? 0.5 : (Math.sin(time / 1400 + d.phase) + 1) / 2;
      ctx.globalAlpha = 0.16 + breath * 0.18 + (push / 14) * 0.35;
      ctx.beginPath();
      ctx.arc(d.x + d.ox, d.y + d.oy, 1 + (push / 14) * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = '#64748b';
      ctx.fill();
    }
    if (!still && !document.hidden) frame = requestAnimationFrame(draw);
  };
  addEventListener('resize', () => {
    resize();
    if (still) draw(0);
  });
  addEventListener(
    'pointermove',
    (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      document.documentElement.style.setProperty('--mx', `${event.clientX}px`);
      document.documentElement.style.setProperty('--my', `${event.clientY}px`);
    },
    { passive: true },
  );
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(frame);
    if (!document.hidden && !still) frame = requestAnimationFrame(draw);
  });
  resize();
  if (still) draw(0);
  else frame = requestAnimationFrame(draw);
})();
