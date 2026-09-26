const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nhubex', {
  print: (printRequest) => ipcRenderer.invoke('print-page', printRequest),
  getPrintSettings: () => ipcRenderer.invoke('print-settings:get'),
  savePrintSettings: (settings) => ipcRenderer.invoke('print-settings:save', settings),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  submitUrl: (url) => ipcRenderer.send('setup-url', url),
});

// Install synchronously, before any POS script can call print(). Installing on
// dom-ready misses inline scripts and window.open().document.write() receipts.
contextBridge.executeInMainWorld({
  func: () => {
    let pendingPrint = null;
    let closeRequested = false;
    const nativeClose = window.close.bind(window);

    function documentLoaded() {
      if (document.readyState === 'complete') return Promise.resolve();
      return new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
    }

    function measureContent() {
      let contentHeightPx = 0;
      for (const element of document.body?.querySelectorAll('*') || []) {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed' || style.opacity === '0') continue;
        contentHeightPx = Math.max(contentHeightPx, element.getBoundingClientRect().bottom + window.scrollY);
      }
      return contentHeightPx || Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0);
    }

    window.print = () => {
      // A load handler and its opener may both request the same ticket. While
      // that job is pending, submit it only once; later reprints remain allowed.
      if (pendingPrint) return;
      pendingPrint = Promise.resolve().then(async () => {
        await documentLoaded();
        await document.fonts.ready;
        await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => {})));
        return window.nhubex.print({ contentHeightPx: measureContent() });
      }).catch((error) => {
        console.error('No se pudo enviar la impresión a Nhubex:', error);
      }).finally(() => {
        // Preserve the usual print()/close() and afterprint/close() POS flows,
        // but don't destroy the ticket before Electron finishes submitting it.
        pendingPrint = null;
        if (closeRequested) {
          closeRequested = false;
          nativeClose();
        }
      });
    };

    window.close = () => {
      if (pendingPrint) closeRequested = true;
      else nativeClose();
    };
  },
});
