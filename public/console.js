const root = document.querySelector('[data-console]');
if (root) {
  const form = document.getElementById('console-form');
  const dirtyLabel = root.querySelector('[data-dirty-label]');
  const fixNote = root.querySelector('[data-fix-note]');
  let dirty = false;
  const markDirty = () => {
    if (dirty) return;
    dirty = true;
    dirtyLabel.hidden = false;
    if (fixNote) fixNote.hidden = false;
    for (const button of root.querySelectorAll('[data-fix]')) button.disabled = true;
  };
  for (const el of root.querySelectorAll('[data-field]')) {
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    const input = form.querySelector(`[data-field-input="${el.dataset.field}"]`);
    const sync = () => {
      input.value = el.innerText.replace(/\n$/, '').trim();
      el.classList.toggle('is-empty', input.value === '');
      markDirty();
    };
    el.classList.toggle('is-empty', input.value === '');
    el.addEventListener('input', sync);
    el.addEventListener('paste', (event) => {
      event.preventDefault();
      document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
    });
    if (el.tagName === 'H1' || el.closest('.console-list'))
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') event.preventDefault();
      });
  }
  for (const el of root.querySelectorAll('[data-watch]')) el.addEventListener('change', markDirty);
  form.addEventListener('submit', () => {
    dirty = false;
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirty) event.preventDefault();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      form.requestSubmit();
    }
  });
}
