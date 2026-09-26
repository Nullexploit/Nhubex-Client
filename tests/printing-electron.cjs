// Real renderer/preload regression tests. Native printing is stubbed: no paper
// is printed and no existing Nhubex profile or remote POS is accessed.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createPrintHandler } = require('../src/printing');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nhubex-print-test-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
process.on('uncaughtException', (error) => { console.error(error); app.exit(1); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await sleep(25);
  }
}
// Never invoke Chromium's real native print if a future regression removes
// the bridge. The expected job will be missing and the test will fail instead.
const safePrint = `if (window.print.toString().includes('[native code]')) throw new Error('Print bridge missing'); window.print();`;
const receipt = '<p>Ticket de prueba</p><div style="height:300px">Contenido al final del ticket</div>';
const server = http.createServer((req, res) => {
  if (req.url === '/download.xml') {
    res.writeHead(200, { 'Content-Type': 'application/xml', 'Content-Disposition': 'attachment; filename="test.xml"' });
    res.end('<test/>');
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  if (req.url === '/early') res.end(`<body><script>${safePrint}</script>${receipt}</body>`);
  else if (req.url === '/late') res.end(`<body>${receipt}<script>addEventListener('load',()=>{${safePrint}})</script></body>`);
  else res.end('<body>Página local sin solicitud de impresión</body>');
});
let jobs = [];
let errors = [];
let silent = true;
const handler = createPrintHandler({
  readConfig: () => ({ printingConfigured: silent, printSettings: { printerName: 'Test_Printer', paperSize: 'ticket-80', marginType: 'none' } }),
  getWindow: (contents) => BrowserWindow.fromWebContents(contents),
  reportError: (message) => errors.push(message),
});
ipcMain.handle('print-page', handler);

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Exercise the production popup options/handlers, without starting its tray,
  // single-instance lock, saved profile, or configured remote environment.
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const navigation = source.slice(source.indexOf('  function configureNavigation()'), source.indexOf('  function createTray()'));
  const scenarios = ['early', 'late', 'document-write', 'print-close', 'duplicate', 'afterprint-close', 'reprint', 'dialog-mode', 'no-print', 'download'];
  for (const scenario of scenarios) {
    jobs = []; errors = []; silent = scenario !== 'dialog-mode';
    const root = new BrowserWindow({ show: false, webPreferences: {
      preload: path.join(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, partition: `print-test-${scenario}`,
    } });
    const hook = (contents) => {
      contents.on('preload-error', (_event, _file, error) => errors.push(error.message));
      contents.print = (options, callback) => {
        const job = { options, completed: false, contents };
        jobs.push(job);
        setTimeout(async () => {
          assert.equal(contents.isDestroyed(), false, `${scenario}: ticket closed before submission`);
          if (scenario === 'afterprint-close') {
            // Chromium emits the print lifecycle events. The bridge must defer
            // a close from that event until the native print callback completes.
            await contents.executeJavaScript("window.dispatchEvent(new Event('afterprint'));void 0;");
            assert.equal(contents.isDestroyed(), false, 'afterprint closed the ticket before the callback');
          }
          job.completed = true;
          callback(true, '');
        }, 120);
      };
    };
    hook(root.webContents);
    let popup;
    let downloads = 0;
    root.webContents.session.on('will-download', (event, item) => {
      downloads += 1;
      item.cancel(); // Verify routing without writing a file to Downloads.
    });
    root.webContents.on('did-create-window', (win) => { popup = win; win.show = () => {}; hook(win.webContents); });
    vm.runInNewContext(`${navigation};configureNavigation();`, {
      mainWindow: root, path, __dirname: path.join(__dirname, '../src'),
    });
    await root.loadURL(origin);
    if (['early', 'late', 'no-print', 'download'].includes(scenario)) {
      const url = `${origin}/${scenario === 'download' ? 'download.xml' : scenario}`;
      await root.webContents.executeJavaScript(`window.open(${JSON.stringify(url)});void 0;`, true);
    } else {
      const inline = scenario === 'document-write' ? `<script>${safePrint}</script>` : '';
      const markup = `<body>${inline}${receipt}</body>`;
      const close = ['print-close', 'duplicate'].includes(scenario) ? 'child.close();' : '';
      const afterprint = scenario === 'afterprint-close' ? `child.addEventListener('afterprint',()=>child.close());` : '';
      await root.webContents.executeJavaScript(`
        window.child = window.open('about:blank');
        child.document.write(${JSON.stringify(markup)});child.document.close();
        ${afterprint}
        if(child.print.toString().includes('[native code]')) throw new Error('Popup print bridge missing');
        ${scenario === 'document-write' ? '' : 'child.print();'}
        ${scenario === 'duplicate' ? 'child.print();' : ''}
        ${close}
        void 0;
      `, true);
    }
    if (['no-print', 'download'].includes(scenario)) {
      if (scenario === 'download') await until(() => downloads === 1, 'Download was not routed');
      await sleep(350);
      assert.equal(jobs.length, 0, `${scenario}: unsolicited print`);
    } else {
      await until(() => jobs[0]?.completed, `${scenario}: missing print job`);
      await sleep(100);
      assert.equal(jobs.length, 1, `${scenario}: duplicate print`);
      assert.equal(jobs[0].options.silent, silent);
      assert.equal(jobs[0].options.deviceName, 'Test_Printer');
      assert.equal(jobs[0].options.pageSize.width, 80000);
      assert.ok(jobs[0].options.pageSize.height > 80000, `${scenario}: measured before receipt was complete`);
      assert.ok(jobs[0].options.pageSize.height < 508000);
      if (['print-close', 'duplicate', 'afterprint-close'].includes(scenario)) {
        await until(() => popup.isDestroyed(), `${scenario}: deferred close not completed`);
      }
      if (scenario === 'reprint') {
        await root.webContents.executeJavaScript('child.print();void 0;', true);
        await until(() => jobs[1]?.completed, 'Reprint did not submit');
        assert.equal(jobs.length, 2);
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${scenario}`);
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
  }
  server.close();
  console.log(`All ${scenarios.length} Electron printing scenarios passed. No physical jobs sent.`);
  app.exit(0);
}).catch((error) => { console.error(error); server.close(); app.exit(1); });
