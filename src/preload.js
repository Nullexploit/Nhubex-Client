const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nhubex', {
  print: () => ipcRenderer.send('print-page'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  submitUrl: (url) => ipcRenderer.send('setup-url', url),
});
