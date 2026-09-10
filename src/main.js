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

  function configurePrinter() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.print({ silent: false, printBackground: true }, (_success, failureReason) => {
        if (failureReason) console.error(`No se pudo configurar la impresora: ${failureReason}`);
      });
    }, 150);
  }

  function createApplicationMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: 'Nhubex',
        submenu: [
          { label: 'Abrir consola', accelerator: process.platform === 'darwin' ? 'Command+Option+I' : 'F12', click: openConsole },
          { label: 'Configurar impresora', click: configurePrinter },
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
        backgroundColor: '#ffffff',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, passwordAutofillEnabled: false },
      },
    }));
    wc.on('did-create-window', (popup) => {
      blockReloadShortcuts(popup.webContents);
      popup.webContents.on('dom-ready', () => {
        if (readConfig()?.printingConfigured !== true) return;
        popup.webContents.print({ silent: true, printBackground: true }, (_success, failureReason) => {
          if (failureReason) console.error(`No se pudo imprimir silenciosamente: ${failureReason}`);
        });
      });
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
    tray.setToolTip('Nhubex');
    const updateTrayMenu = () => tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mostrar Nhubex', click: () => mainWindow.show() },
      { label: 'Abrir consola', click: openConsole },
      { label: 'Configurar impresora', click: configurePrinter },
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
