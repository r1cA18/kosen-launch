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

// Keep the publish button disabled until the confirmation checkbox is checked.
for (const form of document.querySelectorAll('[data-confirm-gate]')) {
  const check = form.querySelector('[data-confirm]');
  const submit = form.querySelector('[data-confirm-submit]');
  const hint = form.querySelector('[data-confirm-hint]');
  const sync = () => {
    submit.disabled = !check.checked;
    if (hint) hint.hidden = check.checked;
  };
  check.addEventListener('change', sync);
  sync();
}

// Long-running forms: show progress and prevent a second submission.
document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-busy]');
  if (!form || event.defaultPrevented) return;
  const button = form.querySelector('button[type=submit], button:not([type])');
  if (!button) return;
  if (form.dataset.sending) {
    event.preventDefault();
    return;
  }
  form.dataset.sending = '1';
  button.disabled = true;
  button.textContent = form.dataset.busy;
});
