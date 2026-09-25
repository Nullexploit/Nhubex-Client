const form = document.getElementById('settings-form');
const status = document.getElementById('status');
const marginType = document.getElementById('marginType');
const customMargins = document.getElementById('custom-margins');
const valueIds = ['printerName', 'paperSize', 'orientation', 'scale', 'marginType', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'printBackground', 'color'];

function updateMarginControls() {
  customMargins.hidden = marginType.value !== 'custom';
}

function fillForm(settings) {
  for (const id of valueIds) {
    const element = document.getElementById(id);
    if (element.type === 'checkbox') element.checked = settings[id] === true;
    else if (settings[id] !== undefined && settings[id] !== '') element.value = settings[id];
  }
  updateMarginControls();
}

async function initialize() {
  try {
    const { settings, printers } = await window.nhubex.getPrintSettings();
    const select = document.getElementById('printerName');
    for (const printer of printers) {
      const option = document.createElement('option');
      option.value = printer.name;
      option.textContent = `${printer.displayName || printer.name}${printer.isDefault ? ' (predeterminada)' : ''}`;
      select.append(option);
    }
    fillForm({ scale: 100, marginType: 'default', marginTop: 10, marginBottom: 10, marginLeft: 10, marginRight: 10, paperSize: 'Letter', orientation: 'portrait', color: true, ...settings });
  } catch (error) {
    status.textContent = `No se pudieron cargar las impresoras: ${error.message}`;
    status.classList.add('error');
  }
}

marginType.addEventListener('change', updateMarginControls);
document.getElementById('cancel').addEventListener('click', () => window.close());
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const settings = {};
  for (const id of valueIds) {
    const element = document.getElementById(id);
    settings[id] = element.type === 'checkbox' ? element.checked : element.value;
  }
  try {
    await window.nhubex.savePrintSettings(settings);
    status.textContent = 'Configuración de impresión guardada.';
  } catch (error) {
    status.textContent = `No se pudo guardar: ${error.message}`;
  }
});

initialize();
