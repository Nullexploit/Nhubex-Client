document.getElementById('setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = document.getElementById('url').value.trim();
  const url = /^https?:\/\/[^\s]+$/i.test(value) ? value : `https://${value}`;
  if (!/^https?:\/\/[^\s]+$/i.test(url)) {
    document.getElementById('error').textContent = 'Escribe una URL válida.';
    return;
  }
  window.nhubex.submitUrl(url);
});
