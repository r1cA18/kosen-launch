// Block editor: edit the work as it will appear, reorder blocks, and lay out images.
(() => {
  const shell = document.querySelector('[data-editor]');
  if (!shell) return;
  const payload = JSON.parse(document.getElementById('editor-data').textContent);
  const state = payload.data;
  const assets = payload.assets;
  const canvas = shell.querySelector('[data-canvas]');
  const saveState = shell.querySelector('[data-save-state]');
  const saveButton = shell.querySelector('[data-save]');
  let revision = Number(shell.dataset.revision);
  let dirty = false;
  let saving = false;

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.filter((c) => c !== null && c !== undefined));
    return node;
  };
  const uid = (type) => `${type}-${Math.random().toString(36).slice(2, 8)}`;
  const markDirty = () => {
    dirty = true;
    saveState.textContent = '未保存の変更があります';
    saveState.classList.add('is-dirty');
  };
  const editable = (tag, value, placeholder, onChange, attrs = {}) => {
    const node = el(tag, {
      ...attrs,
      contenteditable: 'plaintext-only',
      'data-placeholder': placeholder,
      role: 'textbox',
      'aria-label': placeholder,
      class: `${attrs.class ?? ''} editable`,
    });
    if (node.contentEditable !== 'plaintext-only') node.contentEditable = 'true';
    node.textContent = value ?? '';
    node.classList.toggle('is-empty', !value);
    node.addEventListener('input', () => {
      const text = node.innerText.replace(/\n$/, '');
      node.classList.toggle('is-empty', !text.trim());
      onChange(text);
      markDirty();
    });
    node.addEventListener('paste', (event) => {
      event.preventDefault();
      document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
    });
    return node;
  };
  const listText = (items) => items.join('、');
  const parseList = (text) =>
    text
      .split(/[、,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

  function meta() {
    const select = (key, options) =>
      el(
        'select',
        {
          class: 'select select-sm',
          'aria-label': key === 'kind' ? '制作の種類' : '制作の状態',
          onchange: (e) => {
            state[key] = e.target.value;
            markDirty();
          },
        },
        ...Object.entries(options).map(([value, label]) =>
          el('option', { value, selected: state[key] === value, text: label }),
        ),
      );
    const year = el('input', {
      class: 'input input-sm',
      type: 'number',
      min: 2000,
      max: 2100,
      placeholder: '制作年',
      'aria-label': '制作年',
      value: state.year ?? '',
      oninput: (e) => {
        state.year = e.target.value ? Number(e.target.value) : null;
        markDirty();
      },
    });
    return el(
      'div',
      { class: 'editor-meta' },
      select('kind', payload.kinds),
      select('status', payload.statuses),
      year,
    );
  }

  function blockTools(index, extra = []) {
    const block = state.layout[index];
    const move = (delta) => {
      const target = index + delta;
      if (target < 0 || target >= state.layout.length) return;
      state.layout.splice(target, 0, state.layout.splice(index, 1)[0]);
      markDirty();
      render();
      canvas.querySelector(`[data-block-id="${block.id}"] .block-handle`)?.focus();
    };
    return el(
      'div',
      { class: 'block-tools' },
      ...extra,
      el('button', {
        type: 'button',
        class: 'tool',
        'aria-label': '上へ移動',
        text: '↑',
        onclick: () => move(-1),
      }),
      el('button', {
        type: 'button',
        class: 'tool',
        'aria-label': '下へ移動',
        text: '↓',
        onclick: () => move(1),
      }),
      el('button', {
        type: 'button',
        class: 'tool tool-danger',
        text: '削除',
        onclick: () => {
          state.layout.splice(index, 1);
          markDirty();
          render();
        },
      }),
    );
  }

  function imageBlock(block, index) {
    const segment = (label, values, current, apply) =>
      el(
        'span',
        { class: 'tool-group', role: 'group', 'aria-label': label },
        ...values.map(([value, text]) =>
          el('button', {
            type: 'button',
            class: 'tool',
            'aria-pressed': String(current === value),
            text,
            onclick: () => {
              apply(value);
              markDirty();
              render();
            },
          }),
        ),
      );
    const input = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp',
      hidden: true,
      multiple: true,
    });
    input.addEventListener('change', async () => {
      for (const file of input.files) {
        const form = new FormData();
        form.append('image', file);
        form.append('alt', file.name.replace(/\.[^.]+$/, ''));
        saveState.textContent = '画像を追加しています';
        const response = await fetch(`/works/${shell.dataset.work}/assets`, {
          method: 'POST',
          body: form,
        });
        if (!response.ok) {
          saveState.textContent =
            '画像を追加できませんでした。5MB以内のPNG・JPEG・WebPを選んでください。';
          continue;
        }
        const asset = await response.json();
        assets[asset.id] = asset;
        block.asset_ids.push(asset.id);
        if (!state.asset_ids.includes(asset.id)) state.asset_ids.push(asset.id);
      }
      markDirty();
      render();
    });
    const grid = el(
      'div',
      { class: `gallery cols-${block.columns} size-${block.size}` },
      ...block.asset_ids.map((id, i) =>
        el(
          'figure',
          { class: 'editor-image' },
          el('img', { src: assets[id]?.url ?? `/assets/${id}`, alt: assets[id]?.alt ?? '' }),
          el(
            'span',
            { class: 'image-tools' },
            el('button', {
              type: 'button',
              class: 'tool',
              'aria-label': '前へ',
              text: '←',
              onclick: () => {
                if (!i) return;
                block.asset_ids.splice(i - 1, 0, block.asset_ids.splice(i, 1)[0]);
                markDirty();
                render();
              },
            }),
            el('button', {
              type: 'button',
              class: 'tool',
              'aria-label': '後ろへ',
              text: '→',
              onclick: () => {
                if (i === block.asset_ids.length - 1) return;
                block.asset_ids.splice(i + 1, 0, block.asset_ids.splice(i, 1)[0]);
                markDirty();
                render();
              },
            }),
            el('button', {
              type: 'button',
              class: 'tool tool-danger',
              text: '外す',
              onclick: () => {
                block.asset_ids.splice(i, 1);
                markDirty();
                render();
              },
            }),
          ),
        ),
      ),
      el('button', {
        type: 'button',
        class: 'image-add',
        text: '画像を追加',
        onclick: () => input.click(),
      }),
    );
    return [
      grid,
      input,
      blockTools(index, [
        segment(
          '列数',
          [
            [1, '1列'],
            [2, '2列'],
            [3, '3列'],
          ],
          block.columns,
          (v) => (block.columns = v),
        ),
        segment(
          '大きさ',
          [
            ['small', '小'],
            ['medium', '中'],
            ['large', '大'],
          ],
          block.size,
          (v) => (block.size = v),
        ),
      ]),
    ];
  }

  function blockNode(block, index) {
    let body;
    let tools;
    if (block.type === 'field') {
      body = [
        el('h2', { text: payload.fields[block.field] }),
        editable(
          'p',
          state[block.field],
          `${payload.fields[block.field]}を書いてください`,
          (t) => (state[block.field] = t),
        ),
      ];
      tools = blockTools(index);
    } else if (block.type === 'heading') {
      body = [
        editable('h2', block.text, '見出し', (t) => (block.text = t), { class: 'work-heading' }),
      ];
      tools = blockTools(index);
    } else if (block.type === 'text') {
      body = [
        editable('p', block.text, 'テキスト', (t) => (block.text = t), { class: 'work-text' }),
      ];
      tools = blockTools(index);
    } else {
      const [grid, input, imageTools] = imageBlock(block, index);
      body = [grid, input];
      tools = imageTools;
    }
    const node = el(
      'section',
      { class: `editor-block block-${block.type}`, 'data-block-id': block.id },
      el('button', {
        type: 'button',
        class: 'block-handle',
        'aria-label': 'ドラッグして並べ替え（上下の矢印キーでも移動できます）',
        text: '⋮⋮',
        onkeydown: (event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const target = index + (event.key === 'ArrowUp' ? -1 : 1);
          if (target < 0 || target >= state.layout.length) return;
          state.layout.splice(target, 0, state.layout.splice(index, 1)[0]);
          markDirty();
          render();
          canvas.querySelector(`[data-block-id="${block.id}"] .block-handle`)?.focus();
        },
        onpointerdown: (event) => startDrag(event, index, node),
      }),
      tools,
      ...body,
    );
    return node;
  }

  // Pointer-based reordering works for mouse, pen and touch alike.
  function startDrag(event, index, node) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    node.classList.add('is-dragging');
    let target = index;
    const blocks = [...canvas.querySelectorAll('.editor-block')];
    const move = (e) => {
      blocks.forEach((b) => b.classList.remove('drop-before', 'drop-after'));
      target = blocks.length;
      for (let i = 0; i < blocks.length; i++) {
        const box = blocks[i].getBoundingClientRect();
        if (e.clientY < box.top + box.height / 2) {
          target = i;
          break;
        }
      }
      if (target < blocks.length) blocks[target].classList.add('drop-before');
      else blocks.at(-1).classList.add('drop-after');
      if (e.clientY < 120) scrollBy(0, -12);
      else if (e.clientY > innerHeight - 80) scrollBy(0, 12);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      blocks.forEach((b) => b.classList.remove('drop-before', 'drop-after', 'is-dragging'));
      let to = target > index ? target - 1 : target;
      if (to === index) return;
      state.layout.splice(to, 0, state.layout.splice(index, 1)[0]);
      markDirty();
      render();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function addMenu() {
    const used = new Set(state.layout.filter((b) => b.type === 'field').map((b) => b.field));
    const add = (block) => {
      state.layout.push(block);
      markDirty();
      render();
      canvas.querySelector(`[data-block-id="${block.id}"] .editable`)?.focus();
    };
    return el(
      'div',
      { class: 'add-block' },
      el('span', { class: 'quiet', text: 'ブロックを追加' }),
      el('button', {
        type: 'button',
        class: 'btn btn-sm btn-outline',
        text: '見出し',
        onclick: () => add({ id: uid('heading'), type: 'heading', text: '' }),
      }),
      el('button', {
        type: 'button',
        class: 'btn btn-sm btn-outline',
        text: 'テキスト',
        onclick: () => add({ id: uid('text'), type: 'text', text: '' }),
      }),
      el('button', {
        type: 'button',
        class: 'btn btn-sm btn-outline',
        text: '画像',
        onclick: () =>
          add({ id: uid('images'), type: 'images', asset_ids: [], columns: 2, size: 'medium' }),
      }),
      ...Object.entries(payload.fields)
        .filter(([field]) => !used.has(field))
        .map(([field, label]) =>
          el('button', {
            type: 'button',
            class: 'btn btn-sm btn-ghost',
            text: label,
            onclick: () => add({ id: `field-${field}`, type: 'field', field }),
          }),
        ),
    );
  }

  function render() {
    const scroll = scrollY;
    canvas.replaceChildren(
      meta(),
      editable('h1', state.title, '作品名', (t) => (state.title = t.replace(/\n/g, ' '))),
      editable('p', state.summary, 'どんな作品か', (t) => (state.summary = t), {
        class: 'work-summary',
      }),
      el(
        'div',
        { class: 'editor-chips' },
        el('span', { class: 'quiet', text: '担当した役割' }),
        editable(
          'span',
          listText(state.my_roles),
          '役割を「、」区切りで入力',
          (t) => (state.my_roles = parseList(t)),
        ),
      ),
      el('div', { class: 'editor-blocks' }, ...state.layout.map(blockNode)),
      addMenu(),
      el(
        'div',
        { class: 'editor-chips' },
        el('span', { class: 'quiet', text: 'タグ' }),
        editable(
          'span',
          listText(state.tags),
          'タグを「、」区切りで入力',
          (t) => (state.tags = parseList(t)),
        ),
      ),
    );
    scrollTo(0, scroll);
  }

  async function save() {
    if (saving) return false;
    saving = true;
    saveButton.disabled = true;
    saveState.textContent = '保存しています';
    try {
      const response = await fetch(`/works/${shell.dataset.work}/document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision, data: state }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        saveState.textContent =
          body.error ?? '保存できませんでした。入力内容を確認してもう一度保存してください。';
        return false;
      }
      revision = body.revision;
      dirty = false;
      saveState.textContent = '保存しました';
      saveState.classList.remove('is-dirty');
      return true;
    } finally {
      saving = false;
      saveButton.disabled = false;
    }
  }
  saveButton.addEventListener('click', save);
  for (const link of shell.querySelectorAll('[data-preview], [data-review]'))
    link.addEventListener('click', async (event) => {
      if (!dirty) return;
      event.preventDefault();
      if (await save()) location.href = link.href;
    });
  shell.querySelector('[data-notes-toggle]').addEventListener('click', () => {
    const notes = shell.querySelector('[data-notes]');
    notes.hidden = !notes.hidden;
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      save();
    }
  });
  addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });
  render();
})();
