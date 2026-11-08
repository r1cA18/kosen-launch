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
