const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nhubex', {
  print: (printRequest) => ipcRenderer.send('print-page', printRequest),
  getPrintSettings: () => ipcRenderer.invoke('print-settings:get'),
  savePrintSettings: (settings) => ipcRenderer.invoke('print-settings:save', settings),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  submitUrl: (url) => ipcRenderer.send('setup-url', url),
});
