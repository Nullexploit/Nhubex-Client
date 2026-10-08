const PAPER_SIZES = ['driver-default', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid', 'ticket-58', 'ticket-76', 'ticket-80', 'ticket-88'];
const TICKET_WIDTHS = { 'ticket-58': 58000, 'ticket-76': 76200, 'ticket-80': 80000, 'ticket-88': 88000 };

function finiteNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function sanitizePrintSettings(settings = {}) {
  return {
    printerName: typeof settings.printerName === 'string' ? settings.printerName : '',
    paperSize: PAPER_SIZES.includes(settings.paperSize) ? settings.paperSize : 'Letter',
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
}

function truthyDefault(value) {
  return value === true || value === 1 || /^(true|yes|1)$/i.test(String(value || ''));
}

function isDefaultPrinter(printer = {}) {
  const options = printer.options || {};
  return truthyDefault(printer.isDefault)
    || truthyDefault(options.isDefault)
    || truthyDefault(options.default)
    || truthyDefault(options.is_default)
    || truthyDefault(options['is-default'])
    || truthyDefault(options.printer_is_default)
    || truthyDefault(options['printer-is-default']);
}

function normalizePrinters(printers = [], platform = process.platform) {
  const seen = new Set();
  const normalized = [];
  for (const printer of Array.isArray(printers) ? printers : []) {
    const name = typeof printer?.name === 'string' ? printer.name.trim() : '';
    if (!name) continue;
    const key = platform === 'win32' ? name.toLocaleLowerCase() : name;
    if (seen.has(key)) {
      const existing = normalized.find((item) => item.key === key);
      if (existing && isDefaultPrinter(printer)) existing.isDefault = true;
      continue;
    }
    seen.add(key);
    normalized.push({
      key,
      name,
      displayName: (typeof printer.displayName === 'string' && printer.displayName.trim())
        || (typeof printer.description === 'string' && printer.description.trim())
        || name,
      isDefault: isDefaultPrinter(printer),
    });
  }
  return normalized.map(({ key, ...printer }) => printer);
}

async function queryPrinters(getPrinters, platform = process.platform) {
  try {
    const printers = normalizePrinters(await getPrinters(), platform);
    return {
      printers,
      defaultPrinter: printers.find((printer) => printer.isDefault) || null,
      error: null,
    };
  } catch (error) {
    return { printers: [], defaultPrinter: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function validatePrinterSelection(settings, query) {
  if (query.error) return { valid: false, code: 'printer-query-failed', reason: `No se pudieron consultar las impresoras: ${query.error}` };
  if (!query.printers.length) return { valid: false, code: 'no-printers', reason: 'No se detectaron impresoras instaladas en el sistema.' };
  if (!settings.printerName) return { valid: true, printer: query.defaultPrinter, usesSystemDefault: true };
  const printer = query.printers.find((item) => item.name === settings.printerName);
  if (printer) return { valid: true, printer, usesSystemDefault: false };
  return {
    valid: false,
    code: 'printer-unavailable',
    reason: `La impresora configurada “${settings.printerName}” ya no está disponible. Selecciona otra o confirma el uso de la predeterminada del sistema.`,
  };
}

function getPrintOptions(config = {}, printRequest = {}) {
  const saved = sanitizePrintSettings(config?.printSettings || {});
  const options = {
    silent: config?.printingConfigured === true,
    printBackground: saved.printBackground,
    color: saved.color,
    landscape: saved.orientation === 'landscape',
    scaleFactor: saved.scale,
    margins: { marginType: saved.marginType },
  };
  if (saved.printerName) options.deviceName = saved.printerName;
  if (saved.paperSize === 'driver-default') {
    options.usePrinterDefaultPageSize = true;
  } else if (TICKET_WIDTHS[saved.paperSize]) {
    const contentHeightPx = Number(printRequest?.contentHeightPx);
    const scale = options.scaleFactor / 100;
    const marginTopMm = saved.marginType === 'custom' ? saved.marginTop : saved.marginType === 'none' ? 0 : 4;
    const marginBottomMm = saved.marginType === 'custom' ? saved.marginBottom : saved.marginType === 'none' ? 0 : 4;
    const measuredHeightMicrons = Number.isFinite(contentHeightPx) && contentHeightPx > 0
      ? Math.ceil(contentHeightPx * 25400 / 96 * scale + (marginTopMm + marginBottomMm + 4) * 1000)
      : 508000;
    options.pageSize = { width: TICKET_WIDTHS[saved.paperSize], height: Math.max(60000, Math.min(508000, measuredHeightMicrons)) };
  } else {
    options.pageSize = saved.paperSize;
  }
  if (saved.marginType === 'custom') {
    const mmToPixels = (mm) => mm * 96 / 25.4;
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

function isCanceled(reason = '') {
  return /cancel(?:ed|led|ado|ada|ación)?/i.test(reason);
}

function createPrintHandler({ readConfig, getWindow, getPrinters, reportError = () => {}, reportResult = () => {} }) {
  const pending = new WeakMap();
  const safeReportError = (reason, code) => {
    try { reportError(reason, code); } catch { /* Diagnostics must never strand a print job. */ }
  };
  const safeReportResult = (entry) => {
    try { reportResult(entry); } catch { /* Diagnostics must never strand a print job. */ }
  };
  return (event, printRequest = {}) => {
    const contents = event.sender;
    if (pending.has(contents)) return pending.get(contents);
    if (contents.isDestroyed()) {
      const config = readConfig() || {};
      const settings = sanitizePrintSettings(config.printSettings || {});
      const result = { success: false, canceled: false, code: 'window-destroyed', reason: 'La ventana del ticket ya se cerró.' };
      safeReportResult({ attempt: {
        at: new Date().toISOString(), kind: printRequest.kind === 'test' ? 'test' : 'pos',
        printerName: settings.printerName, paperSize: settings.paperSize, silent: config.printingConfigured === true,
      }, result });
      safeReportError(result.reason, result.code);
      return Promise.resolve(result);
    }

    const job = (async () => {
      const config = readConfig() || {};
      const settings = sanitizePrintSettings(config.printSettings || {});
      const attempt = {
        at: new Date().toISOString(), kind: printRequest.kind === 'test' ? 'test' : 'pos',
        printerName: settings.printerName, paperSize: settings.paperSize,
        silent: config.printingConfigured === true,
      };
      const query = await queryPrinters(() => getPrinters(contents));
      if (contents.isDestroyed()) {
        const result = { success: false, canceled: false, code: 'window-destroyed', reason: 'La ventana del ticket se cerró antes de iniciar la impresión.' };
        safeReportResult({ attempt, result });
        safeReportError(result.reason, result.code);
        return result;
      }
      const validation = validatePrinterSelection(settings, query);
      if (!validation.valid) {
        const result = { success: false, canceled: false, code: validation.code, reason: validation.reason };
        safeReportResult({ attempt, result });
        safeReportError(validation.reason, validation.code);
        return result;
      }

      return new Promise((resolve) => {
        const win = getWindow(contents);
        let closeRequested = false;
        let finished = false;
        const deferClose = (closeEvent) => { closeEvent.preventDefault(); closeRequested = true; };
        const onDestroyed = () => finish(false, 'La ventana del ticket se cerró antes de completar la impresión.', 'window-destroyed');
        const finish = (success, reason = '', code = '') => {
          if (finished) return;
          finished = true;
          contents.removeListener('destroyed', onDestroyed);
          if (win && !win.isDestroyed()) win.removeListener('close', deferClose);
          const canceled = !success && isCanceled(reason);
          const result = {
            success, canceled,
            code: code || (success ? 'accepted' : canceled ? 'canceled' : 'print-failed'),
            reason: success ? 'Trabajo aceptado por el subsistema de impresión.' : (reason || 'El controlador no pudo aceptar el trabajo de impresión.'),
          };
          safeReportResult({ attempt, result });
          if (!success && !canceled) safeReportError(result.reason, result.code);
          resolve(result);
          if (closeRequested && win && !win.isDestroyed()) win.close();
        };
        win?.on('close', deferClose);
        contents.once('destroyed', onDestroyed);
        try {
          contents.print(getPrintOptions(config, printRequest), (success, reason) => finish(success, reason));
        } catch (error) {
          finish(false, error instanceof Error ? error.message : String(error), 'electron-error');
        }
      });
    })().finally(() => pending.delete(contents));
    pending.set(contents, job);
    return job;
  };
}

module.exports = {
  PAPER_SIZES, TICKET_WIDTHS, createPrintHandler, getPrintOptions, isCanceled,
  isDefaultPrinter, normalizePrinters, queryPrinters, sanitizePrintSettings, validatePrinterSelection,
};
