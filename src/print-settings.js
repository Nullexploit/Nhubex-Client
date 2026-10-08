const form = document.getElementById('settings-form');
const status = document.getElementById('status');
const printerStatus = document.getElementById('printer-status');
const printerSelect = document.getElementById('printerName');
const printerWarning = document.getElementById('printer-warning');
const marginType = document.getElementById('marginType');
const customMargins = document.getElementById('custom-margins');
const valueIds = ['printerName', 'paperSize', 'orientation', 'scale', 'marginType', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'printBackground', 'color'];

function updateMarginControls() {
  customMargins.hidden = marginType.value !== 'custom';
}

function collectSettings() {
  return Object.fromEntries(valueIds.map((id) => {
    const element = document.getElementById(id);
    return [id, element.type === 'checkbox' ? element.checked : element.value];
  }));
}

function fillForm(settings) {
  for (const id of valueIds) {
    const element = document.getElementById(id);
    if (element.type === 'checkbox') element.checked = settings[id] === true;
    else if (settings[id] !== undefined && settings[id] !== '') element.value = settings[id];
  }
  updateMarginControls();
}

function renderPrinters(state, desiredName) {
  printerSelect.replaceChildren();
  const systemOption = document.createElement('option');
  systemOption.value = '';
  systemOption.textContent = `Predeterminada del sistema${state.defaultPrinter ? ` (${state.defaultPrinter.displayName})` : ''}`;
  printerSelect.append(systemOption);
  for (const printer of state.printers) {
    const option = document.createElement('option');
    option.value = printer.name;
    option.textContent = `${printer.displayName}${printer.isDefault ? ' (predeterminada)' : ''}`;
    printerSelect.append(option);
  }
  const available = !desiredName || state.printers.some((printer) => printer.name === desiredName);
  if (desiredName && !available) {
    const stale = document.createElement('option');
    stale.value = desiredName;
    stale.textContent = `${desiredName} (ya no disponible)`;
    stale.dataset.stale = 'true';
    printerSelect.append(stale);
  }
  printerSelect.value = desiredName || '';
  printerWarning.hidden = available;
  printerWarning.querySelector('p').textContent = available ? '' : 'La impresora guardada ya no está disponible. Selecciona otra o confirma el uso de la predeterminada del sistema.';
}

function formatAttempt(attempt) {
  if (!attempt) return 'Sin intentos registrados';
  const kind = attempt.kind === 'test' ? 'Prueba' : 'POS';
  return `${new Date(attempt.at).toLocaleString()} · ${kind}`;
}

function renderDiagnostics(state) {
  const selected = state.settings.printerName
    ? state.printers.find((printer) => printer.name === state.settings.printerName)?.displayName || `${state.settings.printerName} (no disponible)`
    : 'Predeterminada del sistema';
  document.getElementById('diag-platform').textContent = state.diagnostics.platform;
  document.getElementById('diag-electron').textContent = state.diagnostics.electronVersion;
  document.getElementById('diag-silent').textContent = state.diagnostics.silent ? 'Activada' : 'Desactivada (diálogo del sistema)';
  document.getElementById('diag-printers').textContent = state.error ? `Error: ${state.error}` : String(state.printers.length);
  document.getElementById('diag-default').textContent = state.defaultPrinter?.displayName || 'No identificada';
  document.getElementById('diag-selected').textContent = selected;
  document.getElementById('diag-paper').textContent = state.settings.paperSize;
  document.getElementById('diag-attempt').textContent = formatAttempt(state.diagnostics.lastAttempt);
  const result = state.diagnostics.lastResult;
  document.getElementById('diag-result').textContent = result
    ? `${result.success ? 'Aceptado' : result.canceled ? 'Cancelado' : 'Error'}: ${result.reason}`
    : 'Sin resultados registrados';
}

async function refresh({ preserveCurrent = true } = {}) {
  const desiredName = preserveCurrent ? printerSelect.value : '';
  printerStatus.textContent = 'Consultando impresoras…';
  printerStatus.className = '';
  document.getElementById('refresh-printers').disabled = true;
  try {
    const state = await window.nhubex.getPrintSettings();
    const selection = preserveCurrent ? desiredName : state.settings.printerName;
    renderPrinters(state, selection);
    renderDiagnostics(state);
    if (state.error) {
      printerStatus.textContent = `Error al consultar impresoras: ${state.error}`;
      printerStatus.className = 'error';
    } else if (!state.printers.length) {
      printerStatus.textContent = 'No se detectaron impresoras.';
      printerStatus.className = 'warning-text';
    } else {
      printerStatus.textContent = `${state.printers.length} impresora${state.printers.length === 1 ? '' : 's'} detectada${state.printers.length === 1 ? '' : 's'}.`;
      printerStatus.className = 'success';
    }
    return state;
  } catch (error) {
    printerStatus.textContent = `Error al consultar impresoras: ${error.message}`;
    printerStatus.className = 'error';
    throw error;
  } finally {
    document.getElementById('refresh-printers').disabled = false;
  }
}

async function initialize() {
  fillForm({ scale: 100, marginType: 'default', marginTop: 10, marginBottom: 10, marginLeft: 10, marginRight: 10, paperSize: 'Letter', orientation: 'portrait', color: true });
  try {
    const state = await refresh({ preserveCurrent: false });
    fillForm(state.settings);
    renderPrinters(state, state.settings.printerName);
  } catch (error) {
    status.textContent = `No se pudieron cargar los ajustes: ${error.message}`;
    status.className = 'error';
  }
}

marginType.addEventListener('change', updateMarginControls);
document.getElementById('cancel').addEventListener('click', () => window.close());
document.getElementById('refresh-printers').addEventListener('click', () => refresh().catch(() => {}));
document.getElementById('refresh-diagnostics').addEventListener('click', () => refresh().catch(() => {}));
document.getElementById('use-default').addEventListener('click', async () => {
  await window.nhubex.useSystemDefaultPrinter();
  printerSelect.value = '';
  printerWarning.hidden = true;
  status.textContent = 'Se confirmó el uso de la impresora predeterminada del sistema.';
  status.className = 'success';
  await refresh();
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await window.nhubex.savePrintSettings(collectSettings());
    status.textContent = 'Configuración de impresión guardada.';
    status.className = 'success';
    await refresh();
  } catch (error) {
    status.textContent = `No se pudo guardar: ${error.message}`;
    status.className = 'error';
  }
});
document.getElementById('print-test').addEventListener('click', async () => {
  const button = document.getElementById('print-test');
  button.disabled = true;
  status.textContent = 'Preparando comprobante de prueba…';
  status.className = '';
  try {
    await window.nhubex.savePrintSettings(collectSettings());
    const result = await window.nhubex.printTest();
    status.textContent = result.success
      ? 'El subsistema de impresión aceptó el comprobante de prueba.'
      : result.canceled ? 'Impresión de prueba cancelada por el usuario.' : `No se pudo enviar la prueba: ${result.reason}`;
    status.className = result.success ? 'success' : result.canceled ? '' : 'error';
    await refresh();
  } catch (error) {
    status.textContent = `No se pudo imprimir la prueba: ${error.message}`;
    status.className = 'error';
  } finally {
    button.disabled = false;
  }
});

initialize();
