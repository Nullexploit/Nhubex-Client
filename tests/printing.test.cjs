const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { getPrintOptions, createPrintHandler } = require('../src/printing');

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

function fixture() {
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  const calls = [];
  contents.print = (options, callback) => calls.push({ options, callback });
  const win = new EventEmitter();
  win.isDestroyed = () => false;
  let closed = false;
  win.close = () => { closed = true; };
  const errors = [];
  const print = createPrintHandler({
    readConfig: () => ({ printingConfigured: true }),
    getWindow: () => win,
    reportError: (reason) => errors.push(reason),
  });
  return { contents, calls, win, errors, print, closed: () => closed };
}

test('pending requests are deduplicated and popup close waits for the callback', async () => {
  const f = fixture();
  const job = f.print({ sender: f.contents }, {});
  assert.equal(f.print({ sender: f.contents }, {}), job);
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
  assert.equal(f.calls.length, 2);
  f.calls[1].callback(true);
  await reprint;
});

test('driver errors and synchronous exceptions complete the job and report the error', async () => {
  const f = fixture();
  const job = f.print({ sender: f.contents });
  f.calls[0].callback(false, 'Printer unavailable');
  assert.equal((await job).success, false);
  f.contents.print = () => { throw new Error('Invalid printer settings'); };
  assert.equal((await f.print({ sender: f.contents })).success, false);
  assert.deepEqual(f.errors, ['Printer unavailable', 'Invalid printer settings']);
});

test('canceling the print dialog completes without an error notification', async () => {
  const f = fixture();
  const job = f.print({ sender: f.contents });
  f.calls[0].callback(false, 'Print job canceled');
  assert.equal((await job).success, false);
  assert.deepEqual(f.errors, []);
});

test('a destroyed window cannot leave a pending job or duplicate an error', async () => {
  const f = fixture();
  const job = f.print({ sender: f.contents });
  f.contents.emit('destroyed');
  assert.equal((await job).success, false);
  f.calls[0].callback(false, 'Late callback');
  assert.equal(f.errors.length, 1);
});
