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

  function normalizeUrl(value) {
    const candidate = value.trim();
    if (!/^https?:\/\//i.test(candidate)) return `https://${candidate}`;
    return candidate;
  }

  function configureNavigation() {
    const wc = mainWindow.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      const popup = new BrowserWindow({
        parent: mainWindow,
        width: 1100,
        height: 760,
        minWidth: 700,
        minHeight: 500,
        show: false,
        backgroundColor: '#0b1220',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, passwordAutofillEnabled: false },
      });
      popup.once('ready-to-show', () => popup.show());
      popup.loadURL(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      if (!/^https?:\/\//i.test(url)) event.preventDefault();
    });
  }

  function createTray() {
    const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/2jZ8WQAAAABJRU5ErkJggg==');
    tray = new Tray(icon);
    tray.setToolTip('Nhubex Client');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mostrar Nhubex', click: () => mainWindow.show() },
      { type: 'separator' },
      { label: 'Salir', click: () => { closingByMenu = true; app.quit(); } },
    ]));
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
      autoHideMenuBar: true,
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
        mainWindow.hide();
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
    app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication');
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(['media', 'notifications', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission));
    });
    ipcMain.on('print-page', (event) => event.sender.print({ silent: false, printBackground: true }));
    ipcMain.on('open-external', (_event, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
    createWindow();
  });
  app.on('window-all-closed', () => {});
}
