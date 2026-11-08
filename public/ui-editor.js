// Local-only UI copy editor. Loaded only when the server runs with UI_EDITOR=1 on loopback.
(() => {
  const SKIP = 'script,style,textarea,select,option,input,svg,[data-uie],[contenteditable]';
  const KEY = 'uie-pending';
  const pending = new Map();
  try {
    for (const [from, to] of JSON.parse(sessionStorage.getItem(KEY) || '[]')) pending.set(from, to);
  } catch {}
  const save = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify([...pending]));
    } catch {}
  };
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  };

  const toggle = el('button', { class: 'uie-toggle', type: 'button', 'data-uie': '' }, 'UI編集');
  const panel = el('aside', { class: 'uie-panel', 'data-uie': '', hidden: '' });
  document.body.append(toggle, panel);
  let on = false;
  let wrapped = [];

  function wrapTexts() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.textContent.trim() && !n.parentElement.closest(SKIP)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const original = node.textContent.trim().replace(/\s+/g, ' ');
      const span = el('span', { class: 'uie-text', 'data-uie-original': original });
      node.replaceWith(span);
      span.append(node);
      if (pending.has(original)) mark(span, pending.get(original));
      wrapped.push(span);
    }
  }
  function unwrapTexts() {
    for (const span of wrapped) span.replaceWith(...span.childNodes);
    wrapped = [];
  }
  function mark(span, value) {
    span.textContent = value;
    span.classList.add('uie-changed');
  }
  function edit(span) {
    span.contentEditable = 'plaintext-only';
    if (span.contentEditable !== 'plaintext-only') span.contentEditable = 'true';
    span.focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const finish = () => {
      span.removeAttribute('contenteditable');
      const original = span.dataset.uieOriginal;
      const value = span.textContent.trim().replace(/\s+/g, ' ');
      if (!value || value === original) {
        pending.delete(original);
        span.textContent = original;
        span.classList.remove('uie-changed');
      } else {
        pending.set(original, value);
        mark(span, value);
      }
      save();
      render();
    };
    span.addEventListener('blur', finish, { once: true });
    span.addEventListener('keydown', function key(event) {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        if (event.key === 'Escape') span.textContent = span.dataset.uieOriginal;
        span.removeEventListener('keydown', key);
        span.blur();
      }
    });
  }

  document.addEventListener(
    'click',
    (event) => {
      if (!on || event.target.closest('[data-uie]')) return;
      const span = event.target.closest('.uie-text');
      if (span && span.isContentEditable) return;
      event.preventDefault();
      event.stopPropagation();
      if (span) edit(span);
    },
    true,
  );
  document.addEventListener(
    'submit',
    (event) => {
      if (on) event.preventDefault();
    },
    true,
  );

  function placeholders() {
    return [...document.querySelectorAll('[placeholder]')].filter((n) => !n.closest('[data-uie]'));
  }
  function render(results) {
    panel.replaceChildren();
    panel.append(
      el('h2', { text: 'UI編集' }),
      el('p', {
        class: 'uie-note',
        text: '文言をクリックして直し、Enterで確定します。反映するとsrc/の該当箇所が書き換わります。',
      }),
    );
    const fields = placeholders();
    if (fields.length) {
      const list = el('div', { class: 'uie-fields' });
      for (const field of fields) {
        const original = field.dataset.uieOriginal || field.placeholder;
        field.dataset.uieOriginal = original;
        const input = el('input', { value: pending.get(original) || original });
        input.addEventListener('change', () => {
          const value = input.value.trim();
          if (!value || value === original) pending.delete(original);
          else pending.set(original, value);
          field.placeholder = value || original;
          save();
          render();
        });
        list.append(el('label', {}, el('span', { text: '入力欄の説明' }), input));
      }
      panel.append(list);
    }
    const items = el('ol', { class: 'uie-list' });
    for (const [from, to] of pending) {
      const result = results?.find((r) => r.from === from);
      const item = el(
        'li',
        {},
        el('del', { text: from }),
        el('ins', { text: to }),
        el('button', {
          type: 'button',
          text: '取り消す',
          onclick: () => {
            pending.delete(from);
            save();
            restart();
          },
        }),
      );
      if (result) {
        item.append(el('p', { class: `uie-${result.status}`, text: result.message }));
        if (result.locations.length)
          item.append(el('p', { class: 'uie-where', text: result.locations.join(', ') }));
        if (result.status === 'ambiguous')
          item.append(
            el('button', {
              type: 'button',
              text: 'すべて変更',
              onclick: () => apply([{ from, to, all: true }]),
            }),
          );
      }
      items.append(item);
    }
    panel.append(
      pending.size ? items : el('p', { class: 'uie-note', text: 'まだ変更はありません。' }),
      el('button', {
        class: 'uie-primary',
        type: 'button',
        text: 'ソースに反映',
        disabled: pending.size ? null : '',
        onclick: () => apply([...pending].map(([from, to]) => ({ from, to }))),
      }),
    );
  }
  async function apply(changes) {
    const response = await fetch('/__ui-editor/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes }),
    });
    if (!response.ok) {
      render([]);
      panel.append(
        el('p', {
          class: 'uie-not_found',
          text: '反映できませんでした。サーバーのログを確認してください。',
        }),
      );
      return;
    }
    const { results } = await response.json();
    for (const r of results) if (r.status === 'applied') pending.delete(r.from);
    save();
    render(results);
    if (results.some((r) => r.status === 'applied')) {
      panel.append(
        el('p', {
          class: 'uie-applied',
          text: '反映しました。サーバーの再起動後に再読み込みします。',
        }),
      );
      await new Promise((r) => setTimeout(r, 1500));
      for (let i = 0; i < 40; i++) {
        try {
          if ((await fetch('/health', { cache: 'no-store' })).ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 250));
      }
      location.reload();
    }
  }
  function restart() {
    unwrapTexts();
    if (on) wrapTexts();
    render();
  }
  toggle.addEventListener('click', () => {
    on = !on;
    document.documentElement.classList.toggle('uie-on', on);
    toggle.textContent = on ? 'UI編集を終了' : 'UI編集';
    panel.hidden = !on;
    restart();
    try {
      sessionStorage.setItem('uie-on', on ? '1' : '');
    } catch {}
  });
  try {
    if (sessionStorage.getItem('uie-on')) toggle.click();
  } catch {}
})();
