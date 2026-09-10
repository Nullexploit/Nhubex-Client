document.getElementById('setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const urls = {
    alpha: 'https://nhubex4.tecfinanzas.com/nhubex/SeleccionKatios',
    beta: 'https://macuna.tecfinanzas.com/nhubex/SeleccionKatios',
    production: 'https://www.nhubex.com/nhubex/SeleccionKatios',
  };
  const url = urls[document.getElementById('environment').value];
  if (!url) {
    document.getElementById('error').textContent = 'Selecciona un ambiente.';
    return;
  }
  window.nhubex.submitUrl(url);
});
