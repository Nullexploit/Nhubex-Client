function getPrintOptions(config = {}, printRequest = {}) {
  const saved = config?.printSettings || {};
  const options = {
    silent: config?.printingConfigured === true,
    printBackground: saved.printBackground === true,
    color: saved.color !== false,
    landscape: saved.orientation === 'landscape',
    scaleFactor: Math.min(200, Math.max(10, Number(saved.scale) || 100)),
    margins: { marginType: saved.marginType || 'default' },
  };
  if (saved.printerName) options.deviceName = saved.printerName;
  const ticketWidths = { 'ticket-58': 58000, 'ticket-76': 76200, 'ticket-80': 80000, 'ticket-88': 88000 };
  if (ticketWidths[saved.paperSize]) {
    const contentHeightPx = Number(printRequest?.contentHeightPx);
    const scale = options.scaleFactor / 100;
    const marginTopMm = saved.marginType === 'custom' ? Number(saved.marginTop) || 0 : saved.marginType === 'none' ? 0 : 4;
    const marginBottomMm = saved.marginType === 'custom' ? Number(saved.marginBottom) || 0 : saved.marginType === 'none' ? 0 : 4;
    const measuredHeightMicrons = Number.isFinite(contentHeightPx) && contentHeightPx > 0
      ? Math.ceil(contentHeightPx * 25400 / 96 * scale + (marginTopMm + marginBottomMm + 4) * 1000)
      : 508000;
    // Electron requires fixed media dimensions; approximate the receipt length.
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

function createPrintHandler({ readConfig, getWindow, reportError }) {
  const pending = new WeakMap();
  return (event, printRequest) => {
    const contents = event.sender;
    if (pending.has(contents)) return pending.get(contents);
    if (contents.isDestroyed()) return Promise.resolve({ success: false, reason: 'La ventana del ticket ya se cerró.' });

    let resolveJob;
    const job = new Promise((resolve) => { resolveJob = resolve; });
    pending.set(contents, job);
    const win = getWindow(contents);
    let closeRequested = false;
    let finished = false;
    const deferClose = (closeEvent) => { closeEvent.preventDefault(); closeRequested = true; };
    const onDestroyed = () => finish(false, 'La ventana del ticket se cerró antes de completar la impresión.');
    const finish = (success, reason = '') => {
      if (finished) return;
      finished = true;
      pending.delete(contents);
      contents.removeListener('destroyed', onDestroyed);
      if (win && !win.isDestroyed()) win.removeListener('close', deferClose);
      if (!success && !/cancel/i.test(reason)) reportError(reason || 'El controlador no pudo completar la impresión.');
      resolveJob({ success, reason });
      if (closeRequested && win && !win.isDestroyed()) win.close();
    };
    win?.on('close', deferClose);
    contents.once('destroyed', onDestroyed);
    try {
      contents.print(getPrintOptions(readConfig(), printRequest), finish);
    } catch (error) {
      finish(false, error.message);
    }
    return job;
  };
}

module.exports = { getPrintOptions, createPrintHandler };
