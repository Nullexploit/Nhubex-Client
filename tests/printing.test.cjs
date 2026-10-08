const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createPrintHandler, getPrintOptions, normalizePrinters, queryPrinters,
  sanitizePrintSettings, validatePrinterSelection,
} = require('../src/printing');
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('saved printer, margins, scale and silent toggle are used by every job', () => {
  const config = { printingConfigured: true, printSettings: {
    printerName: 'EPSON_SYSTEM_NAME', paperSize: 'ticket-80', scale: 90,
    marginType: 'custom', marginTop: 2, marginBottom: 3, marginLeft: 1,
    marginRight: 4, orientation: 'landscape', printBackground: true, color: false,
  } };
  const options = getPrintOptions(config, { contentHeightPx: 400 });
  assert.equal(options.silent, true);
  assert.equal(options.deviceName, 'EPSON_SYSTEM_NAME');
  assert.equal(options.pageSize.width, 80000);
  assert.equal(options.pageSize.height, Math.ceil(400 * 25400 / 96 * 0.9 + 9000));
  assert.equal(options.margins.left, 96 / 25.4);
  assert.equal(options.scaleFactor, 90);
  assert.equal(options.landscape, true);
  assert.equal(options.printBackground, true);
  assert.equal(options.color, false);
  assert.equal(getPrintOptions({ ...config, printingConfigured: false }).silent, false);
});

test('all roll widths and missing print measurements are accepted', () => {
  for (const [paperSize, width] of Object.entries({ 'ticket-58': 58000, 'ticket-76': 76200, 'ticket-80': 80000, 'ticket-88': 88000 })) {
    const config = { printSettings: { paperSize } };
    assert.deepEqual(getPrintOptions(config, null).pageSize, { width, height: 508000 });
    assert.equal(getPrintOptions(config, { contentHeightPx: 20 }).pageSize.height, 60000);
    assert.equal(getPrintOptions(config, { contentHeightPx: 10000 }).pageSize.height, 508000);
  }
  assert.equal(getPrintOptions(null).silent, false);
});

test('driver default paper size uses the Electron API without a conflicting pageSize', () => {
  const options = getPrintOptions({ printSettings: { paperSize: 'driver-default' } });
  assert.equal(options.usePrinterDefaultPageSize, true);
  assert.equal('pageSize' in options, false);
});

test('printer enumeration keeps technical names, descriptions and the default without duplicates', () => {
  const printers = normalizePrinters([
    { name: 'EPSON_TM', displayName: 'Epson recepción', isDefault: false },
    { name: 'EPSON_TM', displayName: 'Duplicada', options: { 'printer-is-default': 'true' } },
    { name: 'office_queue', displayName: '', description: 'Impresora oficina' },
    { name: '', displayName: 'Inválida' },
  ], 'linux');
  assert.deepEqual(printers, [
    { name: 'EPSON_TM', displayName: 'Epson recepción', isDefault: true },
    { name: 'office_queue', displayName: 'Impresora oficina', isDefault: false },
  ]);
});

test('printer query represents empty lists and enumeration errors without throwing', async () => {
  assert.deepEqual(await queryPrinters(async () => []), { printers: [], defaultPrinter: null, error: null });
  const failed = await queryPrinters(async () => { throw new Error('spooler unavailable'); });
  assert.deepEqual(failed, { printers: [], defaultPrinter: null, error: 'spooler unavailable' });
});

test('saved printer validation accepts available and explicit system-default selections', () => {
  const query = { printers: [{ name: 'thermal', displayName: 'Thermal', isDefault: true }], defaultPrinter: { name: 'thermal' }, error: null };
  assert.equal(validatePrinterSelection({ printerName: 'thermal' }, query).valid, true);
  assert.equal(validatePrinterSelection({ printerName: '' }, query).usesSystemDefault, true);
  assert.equal(validatePrinterSelection({ printerName: 'removed' }, query).code, 'printer-unavailable');
  assert.equal(validatePrinterSelection({ printerName: '' }, { printers: [], error: null }).code, 'no-printers');
});

test('print settings sanitization preserves supported values and rejects invalid input', () => {
  assert.deepEqual(sanitizePrintSettings({ printerName: 'queue', paperSize: 'driver-default', scale: 300, marginTop: -2 }), {
    printerName: 'queue', paperSize: 'driver-default', orientation: 'portrait', scale: 200,
    marginType: 'default', marginTop: 0, marginBottom: 10, marginLeft: 10, marginRight: 10,
    printBackground: false, color: true,
  });
});

function fixture(overrides = {}) {
  const contents = new EventEmitter();
  contents.isDestroyed = () => overrides.destroyed === true;
  const calls = [];
  contents.print = (options, callback) => calls.push({ options, callback });
  const win = new EventEmitter();
  win.isDestroyed = () => false;
  let closed = false;
  win.close = () => { closed = true; };
  const errors = [];
  const results = [];
  let config = overrides.config || { printingConfigured: true, printSettings: { printerName: 'Test_Printer' } };
  let printers = overrides.printers || [{ name: 'Test_Printer', displayName: 'Test Printer', isDefault: true }];
  const print = createPrintHandler({
    readConfig: () => config,
    getWindow: () => win,
    getPrinters: async () => {
      if (overrides.queryError) throw new Error(overrides.queryError);
      return printers;
    },
    reportError: (reason, code) => errors.push({ reason, code }),
    reportResult: (result) => results.push(result),
  });
  return {
    contents, calls, win, errors, results, print, closed: () => closed,
    setConfig: (value) => { config = value; }, setPrinters: (value) => { printers = value; },
  };
}

test('pending requests are deduplicated and popup close waits for the callback', async () => {
  const f = fixture();
  const job = f.print({ sender: f.contents }, {});
  assert.equal(f.print({ sender: f.contents }, {}), job);
  await tick();
  let prevented = false;
  f.win.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.closed(), false);
  assert.equal(f.calls.length, 1);
  f.calls[0].callback(true);
  assert.equal((await job).success, true);
  assert.equal(f.closed(), true);
  assert.equal(f.win.listenerCount('close'), 0);
  assert.equal(f.contents.listenerCount('destroyed'), 0);
  const reprint = f.print({ sender: f.contents });
  await tick();
  assert.equal(f.calls.length, 2);
  f.calls[1].callback(true);
  await reprint;
});

test('driver errors and synchronous exceptions complete the job and report the error', async () => {
  const f = fixture();
  const job = f.print({ sender: f.contents });
  await tick();
  f.calls[0].callback(false, 'Printer unavailable');
  assert.equal((await job).success, false);
  f.contents.print = () => { throw new Error('Invalid printer settings'); };
  assert.equal((await f.print({ sender: f.contents })).success, false);
  assert.deepEqual(f.errors.map((error) => error.reason), ['Printer unavailable', 'Invalid printer settings']);
});

test('canceling the print dialog completes without an error notification', async () => {
  const f = fixture();
  const job = f.print({ sender: f.contents });
  await tick();
  f.calls[0].callback(false, 'Print job canceled');
  assert.equal((await job).success, false);
  assert.deepEqual(f.errors, []);
});

test('silent jobs are blocked when a saved printer was removed', async () => {
  const f = fixture({ config: { printingConfigured: true, printSettings: { printerName: 'Removed_Printer' } } });
  const result = await f.print({ sender: f.contents });
  assert.equal(result.code, 'printer-unavailable');
  assert.equal(f.calls.length, 0);
  assert.equal(f.errors.length, 1);
});

test('empty enumeration and query failures block safely with distinct diagnostics', async () => {
  const empty = fixture({ printers: [] });
  assert.equal((await empty.print({ sender: empty.contents })).code, 'no-printers');
  const failed = fixture({ queryError: 'CUPS unavailable' });
  assert.equal((await failed.print({ sender: failed.contents })).code, 'printer-query-failed');
});

test('dialog mode and test receipts use the same configuration and record their result', async () => {
  const f = fixture({ config: { printingConfigured: false, printSettings: { printerName: '', paperSize: 'A4' } } });
  const job = f.print({ sender: f.contents }, { kind: 'test' });
  await tick();
  assert.equal(f.calls[0].options.silent, false);
  assert.equal(f.calls[0].options.pageSize, 'A4');
  f.calls[0].callback(true);
  assert.equal((await job).success, true);
  assert.equal(f.results[0].attempt.kind, 'test');
  assert.equal(f.results[0].result.reason, 'Trabajo aceptado por el subsistema de impresión.');
});

test('a destroyed window cannot leave a pending job or duplicate an error', async () => {
  const f = fixture();
  const job = f.print({ sender: f.contents });
  await tick();
  f.contents.emit('destroyed');
  assert.equal((await job).success, false);
  f.calls[0].callback(false, 'Late callback');
  assert.equal(f.errors.length, 1);
});

test('a window destroyed before the request is diagnosed without querying or printing', async () => {
  const f = fixture({ destroyed: true });
  const result = await f.print({ sender: f.contents });
  assert.equal(result.code, 'window-destroyed');
  assert.equal(f.calls.length, 0);
  assert.equal(f.results.length, 1);
  assert.equal(f.errors.length, 1);
});
