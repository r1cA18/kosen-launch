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
