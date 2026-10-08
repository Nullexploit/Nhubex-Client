const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, session, shell, Tray } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createPrintHandler, queryPrinters, sanitizePrintSettings } = require('./printing');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow;
  let tray;
  let printSettingsWindow;
  let closingByMenu = false;
  let configPath;
  let printHandler;

  app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication');

  function getConfigPath() {
    return path.join(app.getPath('cache'), 'nhubex-client-config.json');
  }

  function readConfig() {
    configPath = configPath || getConfigPath();
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      return null;
    }
  }

  function saveConfig(url) {
    configPath = configPath || getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const config = readConfig() || {};
    fs.writeFileSync(configPath, JSON.stringify({ ...config, url, configuredAt: new Date().toISOString() }), 'utf8');
  }

  function setPrintingConfigured(enabled) {
    const config = readConfig() || {};
    config.printingConfigured = enabled;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
  }

  function writeConfig(config) {
    configPath = configPath || getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  function savePrintSettings(settings) {
    const config = readConfig() || {};
    config.printSettings = sanitizePrintSettings(settings);
    writeConfig(config);
    return config.printSettings;
  }

  function recordPrintResult(entry) {
    try {
      const config = readConfig() || {};
      config.printDiagnostics = {
        lastAttempt: entry.attempt,
        lastResult: entry.result,
      };
      writeConfig(config);
    } catch (error) {
      console.error(`No se pudo guardar el último resultado de impresión: ${error.message}`);
    }
    if (!entry.result.success && !entry.result.canceled) {
      const safeReason = String(entry.result.reason || 'Error desconocido').replace(/[\r\n]+/g, ' ').slice(0, 500);
      const line = `${new Date().toISOString()} [${entry.result.code}] ${safeReason}\n`;
      const logPath = path.join(app.getPath('logs'), 'printing.log');
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      try {
        if (fs.existsSync(logPath) && fs.statSync(logPath).size > 262144) {
          fs.copyFileSync(logPath, `${logPath}.previous`);
          fs.truncateSync(logPath, 0);
        }
        fs.appendFileSync(logPath, line, 'utf8');
      } catch (error) {
        console.error(`No se pudo guardar el diagnóstico de impresión: ${error.message}`);
      }
    }
  }

  function printerWebContents() {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow.webContents;
    if (printSettingsWindow && !printSettingsWindow.isDestroyed()) return printSettingsWindow.webContents;
    return null;
  }

  async function getPrinterState() {
    const contents = printerWebContents();
    const query = contents
      ? await queryPrinters(() => contents.getPrintersAsync())
      : { printers: [], defaultPrinter: null, error: 'No hay una ventana disponible para consultar impresoras.' };
    const config = readConfig() || {};
    return {
      ...query,
      settings: sanitizePrintSettings(config.printSettings || {}),
      diagnostics: {
        platform: process.platform,
        electronVersion: process.versions.electron,
        silent: config.printingConfigured === true,
        lastAttempt: config.printDiagnostics?.lastAttempt || null,
        lastResult: config.printDiagnostics?.lastResult || null,
      },
    };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  async function printTestReceipt() {
    const state = await getPrinterState();
    const selected = state.settings.printerName
      ? state.printers.find((printer) => printer.name === state.settings.printerName)?.displayName || state.settings.printerName
      : state.defaultPrinter?.displayName || 'Predeterminada del sistema';
    const testWindow = new BrowserWindow({
      show: false,
      width: 420,
      height: 640,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const now = new Date().toLocaleString();
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font:14px sans-serif;margin:20px;color:#111}h1{font-size:18px;border-bottom:1px dashed #555;padding-bottom:10px}
      dl{display:grid;grid-template-columns:auto 1fr;gap:7px 12px}dt{font-weight:bold}dd{margin:0;overflow-wrap:anywhere}
    </style></head><body><h1>Nhubex — Prueba de impresión</h1><dl>
      <dt>Fecha y hora</dt><dd>${escapeHtml(now)}</dd><dt>Sistema operativo</dt><dd>${escapeHtml(process.platform)}</dd>
      <dt>Impresora</dt><dd>${escapeHtml(selected)}</dd><dt>Tamaño de papel</dt><dd>${escapeHtml(state.settings.paperSize)}</dd>
      <dt>Estado del envío</dt><dd>Pendiente de confirmación del subsistema de impresión</dd>
    </dl><p>Este comprobante es local y no contiene datos del POS.</p></body></html>`;
    try {
      await testWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      return await printHandler({ sender: testWindow.webContents }, { kind: 'test', contentHeightPx: 500 });
    } finally {
      if (!testWindow.isDestroyed()) testWindow.destroy();
    }
  }

  function openConsole() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  async function uninstallNhubex() {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Desinstalar Nhubex',
      message: '¿Deseas borrar la configuración y los datos locales de Nhubex?',
      detail: 'En Windows también se abrirá el desinstalador de Nhubex. Esta acción no borra datos del servidor POS.',
      buttons: ['Cancelar', 'Borrar y desinstalar'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return;

    try {
      await session.defaultSession.clearStorageData();
      await session.defaultSession.clearCache();
      fs.rmSync(app.getPath('cache'), { recursive: true, force: true });
    } catch (error) {
      console.error(`No se pudieron borrar todos los datos locales: ${error.message}`);
    }

    if (process.platform === 'win32') {
      const uninstaller = path.join(path.dirname(app.getPath('exe')), 'Uninstall Nhubex.exe');
      if (fs.existsSync(uninstaller)) shell.openPath(uninstaller);
    }
    closingByMenu = true;
    app.quit();
  }

  function openPrintSettings() {
    if (printSettingsWindow && !printSettingsWindow.isDestroyed()) {
      printSettingsWindow.show();
      printSettingsWindow.focus();
      return;
    }
    printSettingsWindow = new BrowserWindow({
      width: 720,
      height: 900,
      minWidth: 540,
      minHeight: 740,
      title: 'Ajustes de impresión — Nhubex',
      parent: mainWindow,
      modal: true,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    printSettingsWindow.once('ready-to-show', () => printSettingsWindow.show());
    printSettingsWindow.on('closed', () => { printSettingsWindow = null; });
    printSettingsWindow.loadFile(path.join(__dirname, 'print-settings.html'));
  }

  function notifyDownload(title, body) {
    if (Notification.isSupported()) new Notification({ title, body }).show();
    if (process.platform === 'win32' && tray?.displayBalloon) tray.displayBalloon({ title, content: body });
    if (mainWindow && !mainWindow.isDestroyed()) {
      const message = JSON.stringify(`${title}: ${body}`);
      mainWindow.webContents.executeJavaScript(`(() => {
        let toast = document.getElementById('__nhubex-download-notice');
        if (!toast) {
          toast = document.createElement('div');
          toast.id = '__nhubex-download-notice';
          Object.assign(toast.style, { position: 'fixed', zIndex: '2147483647', right: '20px', bottom: '20px', maxWidth: '420px', padding: '14px 18px', borderRadius: '10px', background: '#10243b', color: '#fff', boxShadow: '0 5px 24px #0005', font: '14px -apple-system,BlinkMacSystemFont,sans-serif', opacity: '0', transition: 'opacity .2s' });
          document.body.appendChild(toast);
        }
        toast.textContent = ${message};
        toast.style.opacity = '1';
        clearTimeout(window.__nhubexDownloadNoticeTimer);
        window.__nhubexDownloadNoticeTimer = setTimeout(() => { toast.style.opacity = '0'; }, 5000);
      })();`).catch(() => {});
    }
  }

  function createApplicationMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: 'Nhubex',
        submenu: [
          { label: 'Abrir consola', accelerator: process.platform === 'darwin' ? 'Command+Option+I' : 'F12', click: openConsole },
          { label: 'Ajustes de impresión', click: openPrintSettings },
          { label: 'Impresión silenciosa', type: 'checkbox', checked: readConfig()?.printingConfigured === true, click: (item) => setPrintingConfigured(item.checked) },
          {
            label: 'Configuración',
            submenu: [
              { label: 'Desinstalar Nhubex', click: uninstallNhubex },
            ],
          },
          { type: 'separator' },
          { label: 'Salir', enabled: false },
        ],
      },
    ]));
  }

  function normalizeUrl(value) {
    const candidate = value.trim();
    if (!/^https?:\/\//i.test(candidate)) return `https://${candidate}`;
    return candidate;
  }

  function configureNavigation() {
    const wc = mainWindow.webContents;
    const blockReloadShortcuts = (contents) => contents.on('before-input-event', (event, input) => {
      const key = String(input.key || '').toLowerCase();
      const reloadShortcut = input.key === 'F5'
        || (key === 'r' && (input.control || input.meta));
      const pasteShortcut = key === 'v' && (input.control || input.meta);
      if (reloadShortcut || pasteShortcut) event.preventDefault();
    });
    blockReloadShortcuts(wc);
    wc.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1100,
        height: 760,
        minWidth: 700,
        minHeight: 500,
        show: false,
        backgroundColor: '#ffffff',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js'), passwordAutofillEnabled: false },
      },
    }));
    wc.on('did-create-window', (popup) => {
      blockReloadShortcuts(popup.webContents);
      popup.once('ready-to-show', () => {
        // Solo se muestran pop-ups que realmente cargan una página; las descargas
        // y documentos temporales de impresión permanecen ocultos.
        if (popup.webContents.getURL() !== 'about:blank') popup.show();
      });
      popup.webContents.on('did-finish-load', () => {
        if (popup.webContents.getURL() !== 'about:blank') popup.show();
      });
    });
    wc.on('will-navigate', (event, url) => {
      if (!/^https?:\/\//i.test(url)) event.preventDefault();
    });
  }

  function createTray() {
    const iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect width="18" height="18" rx="4" fill="#0ea5e9"/><path d="M4 14V4h2l6 6V4h2v10h-2L6 8v6z" fill="white"/></svg>';
    const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`);
    tray = new Tray(icon);
    tray.setToolTip('Nhubex');
    const updateTrayMenu = () => tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mostrar Nhubex', click: () => mainWindow.show() },
      { label: 'Abrir consola', click: openConsole },
      { label: 'Ajustes de impresión', click: openPrintSettings },
      { label: 'Impresión silenciosa', type: 'checkbox', checked: readConfig()?.printingConfigured === true, click: (item) => setPrintingConfigured(item.checked) },
      { label: 'Configuración', submenu: [{ label: 'Desinstalar Nhubex', click: uninstallNhubex }] },
      { type: 'separator' },
      { label: 'Salir', enabled: false },
    ]));
    updateTrayMenu();
    createApplicationMenu();
    tray.on('double-click', () => mainWindow.show());
  }

  async function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 650,
      title: 'Nhubex',
      backgroundColor: '#0b1220',
      autoHideMenuBar: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: true,
        spellcheck: false,
        passwordAutofillEnabled: false,
      },
    });
    mainWindow.on('close', (event) => {
      if (!closingByMenu) {
        event.preventDefault();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    mainWindow.on('closed', () => {
      if (!closingByMenu) {
        mainWindow = null;
        createWindow();
      }
    });
    configureNavigation();
    createTray();

    const config = readConfig();
    if (!config?.url) {
      await mainWindow.loadFile(path.join(__dirname, 'setup.html'));
      ipcMain.once('setup-url', (_event, value) => {
        const url = normalizeUrl(String(value || ''));
        if (!/^https?:\/\/[^\s]+$/i.test(url)) return;
        saveConfig(url);
        mainWindow.loadURL(url);
      });
    } else {
      await mainWindow.loadURL(config.url);
    }
  }

  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
  app.on('before-quit', () => { closingByMenu = true; });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(['media', 'notifications', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission));
    });
    session.defaultSession.on('will-download', (_event, item) => {
      const downloadsPath = app.getPath('downloads');
      const originalName = item.getFilename() || 'Nhubex-download';
      const extension = path.extname(originalName);
      const baseName = extension ? originalName.slice(0, -extension.length) : originalName;
      let destination = path.join(downloadsPath, originalName);
      let counter = 1;
      while (fs.existsSync(destination)) {
        destination = path.join(downloadsPath, `${baseName} (${counter})${extension}`);
        counter += 1;
      }
      item.setSavePath(destination);
      notifyDownload('Nhubex', `Descarga iniciada: ${originalName}`);
      item.once('done', (_doneEvent, state) => {
        if (state === 'completed') notifyDownload('Nhubex', `Descarga completada: ${path.basename(destination)}`);
        else notifyDownload('Nhubex', `La descarga no se completó: ${originalName}`);
      });
    });
    ipcMain.handle('print-settings:get', getPrinterState);
    ipcMain.handle('print-settings:save', (_event, settings) => savePrintSettings(settings || {}));
    ipcMain.handle('print-settings:test', printTestReceipt);
    ipcMain.handle('print-settings:use-default', () => {
      const settings = savePrintSettings({ ...(readConfig()?.printSettings || {}), printerName: '' });
      return settings;
    });
    printHandler = createPrintHandler({
      readConfig,
      getWindow: (contents) => BrowserWindow.fromWebContents(contents),
      getPrinters: (contents) => contents.getPrintersAsync(),
      reportResult: recordPrintResult,
      reportError: (reason, code) => {
        console.error(`No se pudo imprimir: ${reason}`);
        const unavailable = code === 'printer-unavailable';
        dialog.showMessageBox(printSettingsWindow || mainWindow, {
          type: 'error',
          title: 'Nhubex — No se pudo imprimir',
          message: 'El ticket no se pudo enviar a la impresora.',
          detail: `${reason}\nRevisa la conexión y la impresora seleccionada en Nhubex → Ajustes de impresión.`,
          buttons: unavailable ? ['Cancelar', 'Abrir ajustes', 'Usar predeterminada del sistema'] : ['Aceptar', 'Abrir ajustes'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        }).then(({ response }) => {
          if (unavailable && response === 2) savePrintSettings({ ...(readConfig()?.printSettings || {}), printerName: '' });
          else if ((!unavailable && response === 1) || (unavailable && response === 1)) openPrintSettings();
        }).catch(console.error);
      },
    });
    ipcMain.handle('print-page', printHandler);
    ipcMain.on('open-external', (_event, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
    createWindow();
  });
  app.on('window-all-closed', () => {});
}
