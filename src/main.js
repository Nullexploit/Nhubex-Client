const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, session, shell, Tray } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow;
  let tray;
  let printSettingsWindow;
  let closingByMenu = false;
  let configPath;

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

  function getPrintOptions(printRequest = {}) {
    const saved = readConfig()?.printSettings || {};
    const options = {
      silent: readConfig()?.printingConfigured === true,
      printBackground: saved.printBackground === true,
      color: saved.color !== false,
      landscape: saved.orientation === 'landscape',
      scaleFactor: Math.min(200, Math.max(10, Number(saved.scale) || 100)),
      margins: { marginType: saved.marginType || 'default' },
    };
    if (saved.printerName) options.deviceName = saved.printerName;
    const ticketWidths = { 'ticket-58': 58000, 'ticket-76': 76200, 'ticket-80': 80000, 'ticket-88': 88000 };
    if (ticketWidths[saved.paperSize]) {
      const contentHeightPx = Number(printRequest.contentHeightPx);
      const scale = options.scaleFactor / 100;
      const marginTopMm = saved.marginType === 'custom' ? Number(saved.marginTop) || 0 : 4;
      const marginBottomMm = saved.marginType === 'custom' ? Number(saved.marginBottom) || 0 : 4;
      const measuredHeightMicrons = Number.isFinite(contentHeightPx) && contentHeightPx > 0
        ? Math.ceil(contentHeightPx * 25400 / 96 * scale + (marginTopMm + marginBottomMm + 4) * 1000)
        : 508000;
      // Electron requires a fixed media height. Use the document's measured content height
      // for receipt rolls, with a conservative 508 mm cap and a 60 mm minimum.
      options.pageSize = { width: ticketWidths[saved.paperSize], height: Math.max(60000, Math.min(508000, measuredHeightMicrons)) };
    } else if (saved.paperSize) {
      options.pageSize = saved.paperSize;
    }
    if (saved.marginType === 'custom') {
      const mmToPixels = (mm) => Math.max(0, Number(mm) || 0) * 96 / 25.4;
      options.margins = {
        marginType: 'custom',
        top: mmToPixels(saved.marginTop),
        bottom: mmToPixels(saved.marginBottom),
        left: mmToPixels(saved.marginLeft),
        right: mmToPixels(saved.marginRight),
      };
    }
    return options;
  }

  function savePrintSettings(settings) {
    const config = readConfig() || {};
    const finiteNumber = (value, fallback, min, max) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    };
    config.printSettings = {
      printerName: typeof settings.printerName === 'string' ? settings.printerName : '',
      paperSize: ['A4', 'A5', 'Letter', 'Legal', 'Tabloid', 'ticket-58', 'ticket-76', 'ticket-80', 'ticket-88'].includes(settings.paperSize) ? settings.paperSize : 'Letter',
      orientation: settings.orientation === 'landscape' ? 'landscape' : 'portrait',
      scale: finiteNumber(settings.scale, 100, 10, 200),
      marginType: ['default', 'none', 'printableArea', 'custom'].includes(settings.marginType) ? settings.marginType : 'default',
      marginTop: finiteNumber(settings.marginTop, 10, 0, 100),
      marginBottom: finiteNumber(settings.marginBottom, 10, 0, 100),
      marginLeft: finiteNumber(settings.marginLeft, 10, 0, 100),
      marginRight: finiteNumber(settings.marginRight, 10, 0, 100),
      printBackground: settings.printBackground === true,
      color: settings.color !== false,
    };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return config.printSettings;
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
      width: 620,
      height: 820,
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
    const installPrintBridge = (contents) => {
      contents.on('dom-ready', () => {
        contents.executeJavaScript(`(() => {
          if (!window.nhubex || window.__nhubexPrintBridgeInstalled) return;
          Object.defineProperty(window, '__nhubexPrintBridgeInstalled', { value: true });
          window.print = () => {
            const root = document.documentElement;
            const body = document.body;
            let contentHeightPx = 0;
            for (const element of body?.querySelectorAll('*') || []) {
              const style = window.getComputedStyle(element);
              if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed' || style.opacity === '0') continue;
              const rect = element.getBoundingClientRect();
              contentHeightPx = Math.max(contentHeightPx, rect.bottom + window.scrollY);
            }
            if (!contentHeightPx) contentHeightPx = Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0);
            window.nhubex.print({ contentHeightPx });
          };
        })();`, true).catch(() => {});
      });
    };
    const blockReloadShortcuts = (contents) => contents.on('before-input-event', (event, input) => {
      const key = String(input.key || '').toLowerCase();
      const reloadShortcut = input.key === 'F5'
        || (key === 'r' && (input.control || input.meta));
      const pasteShortcut = key === 'v' && (input.control || input.meta);
      if (reloadShortcut || pasteShortcut) event.preventDefault();
    });
    blockReloadShortcuts(wc);
    installPrintBridge(wc);
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
      installPrintBridge(popup.webContents);
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
    ipcMain.handle('print-settings:get', async () => {
      const printers = mainWindow && !mainWindow.isDestroyed()
        ? await mainWindow.webContents.getPrintersAsync()
        : [];
      return { settings: readConfig()?.printSettings || {}, printers: printers.map(({ name, displayName, isDefault }) => ({ name, displayName, isDefault })) };
    });
    ipcMain.handle('print-settings:save', (_event, settings) => savePrintSettings(settings || {}));
    ipcMain.on('print-page', (event, printRequest) => {
      event.sender.print(getPrintOptions(printRequest), (success, failureReason) => {
        if (failureReason) console.error(`No se pudo imprimir: ${failureReason}`);
        else if (!success) console.warn('La solicitud de impresión no se completó.');
      });
    });
    ipcMain.on('open-external', (_event, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
    createWindow();
  });
  app.on('window-all-closed', () => {});
}
