const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, Tray } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow;
  let tray;
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
    fs.writeFileSync(configPath, JSON.stringify({ url, configuredAt: new Date().toISOString() }), 'utf8');
  }

  function setPrintingConfigured(enabled) {
    const config = readConfig() || {};
    config.printingConfigured = enabled;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
  }

  function configurePrinter() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.print({ silent: false, printBackground: true }, (_success, failureReason) => {
      if (failureReason) console.error(`No se pudo configurar la impresora: ${failureReason}`);
    });
  }

  function createApplicationMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: 'Nhubex',
        submenu: [
          { label: 'Configurar impresora', click: configurePrinter },
          { label: 'Impresión silenciosa', type: 'checkbox', checked: readConfig()?.printingConfigured === true, click: (item) => setPrintingConfigured(item.checked) },
          { type: 'separator' },
          { label: 'Salir', click: () => { closingByMenu = true; app.quit(); } },
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
      if (reloadShortcut) event.preventDefault();
    });
    blockReloadShortcuts(wc);
    wc.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1100,
        height: 760,
        minWidth: 700,
        minHeight: 500,
        backgroundColor: '#ffffff',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, passwordAutofillEnabled: false },
      },
    }));
    wc.on('did-create-window', (popup) => {
      blockReloadShortcuts(popup.webContents);
      popup.once('ready-to-show', () => {
        // Las ventanas about:blank suelen ser documentos temporales de impresión.
        // Se mantienen ocultas para que no aparezca un fondo oscuro detrás del diálogo.
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
    tray.setToolTip('Nhubex Client');
    const updateTrayMenu = () => tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mostrar Nhubex', click: () => mainWindow.show() },
      { label: 'Configurar impresora', click: configurePrinter },
      { label: 'Impresión silenciosa', type: 'checkbox', checked: readConfig()?.printingConfigured === true, click: (item) => setPrintingConfigured(item.checked) },
      { type: 'separator' },
      { label: 'Salir', click: () => { closingByMenu = true; app.quit(); } },
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
      title: 'Nhubex Client',
      backgroundColor: '#0b1220',
      autoHideMenuBar: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
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
    ipcMain.on('print-page', (event) => {
      const config = readConfig() || {};
      const silent = config.printingConfigured === true;
      event.sender.print({ silent, printBackground: true }, (success, failureReason) => {
        if (failureReason) console.error(`No se pudo imprimir: ${failureReason}`);
      });
    });
    ipcMain.on('open-external', (_event, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
    createWindow();
  });
  app.on('window-all-closed', () => {});
}
