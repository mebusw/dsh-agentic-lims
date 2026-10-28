/**
 * Headless UI smoke test for the right-sidebar panel.
 *
 * Boots the real `client.js` in chromium with a tiny DSH stand-in:
 *   - a fake ModuleLoader + Cordis context that records slot registrations;
 *   - React/ReactDOM UMD loaded from a local vendor directory;
 *   - `/api/lims/*` served by the real host routes against a temporary MongoDB;
 *   - a driver that clicks through 概览 → 订单 → 影响 → 排程, quotes a card into
 *     the fake chat composer, and submits a sample-delay change.
 *
 * The panel must render, the new pages must appear, the quote must reach
 * `inputActions`, and the change analysis must come back from the engine.
 *
 * Prerequisites (skipped with exit 0 when missing):
 *   - Chrome/Chromium headless: set CHROME_BIN or install Playwright's cache;
 *   - React 18 UMD builds: set AGENTIC_LIMS_UI_VENDOR to a directory holding
 *     react.js and react-dom.js.
 *
 * Run: node agentic-lims/scripts/check-ui-render.mjs
 */
import http from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { buildRoutes } from '../lib/routes.js';
import { ensureIndexes, seedDatabase } from '../lib/seed.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');

const VENDOR = process.env.AGENTIC_LIMS_UI_VENDOR || '/tmp/lims-harness/vendor';
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  `${process.env.HOME ?? ''}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
  `${process.env.HOME ?? ''}/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function pickChrome() {
  for (const candidate of CHROME_CANDIDATES) if (await exists(candidate)) return candidate;
  return null;
}

const chrome = await pickChrome();
const hasVendor = (await exists(`${VENDOR}/react.js`)) && (await exists(`${VENDOR}/react-dom.js`));
if (!chrome || !hasVendor) {
  console.log(`ui render check skipped: chrome=${chrome ?? 'missing'} reactVendor=${hasVendor ? VENDOR : 'missing'}`);
  console.log('Set CHROME_BIN and AGENTIC_LIMS_UI_VENDOR (react.js + react-dom.js UMD builds) to run it.');
  process.exit(0);
}

const client = await MongoClient.connect(process.env.AGENTIC_LIMS_MONGO_URI || 'mongodb://127.0.0.1:27018', {
  serverSelectionTimeoutMS: 3000,
});
const db = client.db('agentic_lims_ui_harness');
await db.dropDatabase();
await ensureIndexes(db);
await seedDatabase(db);
const routes = buildRoutes({ db, config: { demoNow: '2026-10-27T08:00:00+08:00' } });

const harness = `<!doctype html><html><head><meta charset="utf-8"><title>booting</title>
<style>html,body{margin:0;height:100%}#root{height:100%}</style></head><body><div id="root"></div>
<script src="/vendor/react.js"></script><script src="/vendor/react-dom.js"></script>
<script>
window.__errors = [];
window.addEventListener('error', function (e) { window.__errors.push('error: ' + e.message); });
window.addEventListener('unhandledrejection', function (e) { window.__errors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason)); });
window.__registered = {};
window.__ModuleLoader__ = { load: function (def) { window.__module = def.factory(function (name) { if (name === 'react') return React; throw new Error('require ' + name); }); } };
</script>
<script src="/client.js"></script>
<script>
var registered = window.__registered;
function fakeCtx() {
  var ctx = {
    effect: function (fn) { var d = fn(); return typeof d === 'function' ? d : function () {}; },
    inject: function (names, callback) { callback(ctx); },
    slots: {
      inject: function (name, callback) { callback(); },
      register: function (definition, component) { registered[definition.name] = component; registered[definition.name + '|' + (definition.key || definition.id || '')] = component; return function () {}; },
    },
    uiConversation: { events: { register: function () { return function () {}; } } },
    sidebarRightTabs: { register: function () { return function () {}; } },
    sidebarRight: { mounted: { getSnapshot: function () { return null; }, subscribe: function () { return function () {}; } }, openTab: function () {} },
  };
  return ctx;
}
var inputActions = {
  _text: '',
  captureInsertion: function () { return { rev: 1, start: 0, end: 0 }; },
  insertText: function (text) { inputActions._text += text; document.body.setAttribute('data-quote', inputActions._text); return true; },
  setDraft: function (text) { inputActions._text = text; document.body.setAttribute('data-quote', text); },
};
window.__inputActions = inputActions;
window.__module.apply(fakeCtx());
var Panel = registered['sidebar.right.pane.tab'];
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Panel, { inputActions: inputActions }));

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function tabByLabel(label) {
  return Array.prototype.slice.call(document.querySelectorAll('[role=tab]')).filter(function (t) { return t.textContent.indexOf(label) >= 0; })[0];
}
async function run() {
  await sleep(1000);
  var only = new URLSearchParams(location.search).get('only');
  if (only) {
    var target = tabByLabel(only);
    if (target) target.click();
    await sleep(1800);
    document.title = 'ONLY ' + only;
    return;
  }
  var steps = {};
  steps.nav = Array.prototype.map.call(document.querySelectorAll('[role=tab]'), function (t) { return t.textContent; });
  steps.dashboard = /Agent 协作入口/.test(document.body.innerText);
  steps.sampleCard = /样品到位 · HC-007/.test(document.body.innerText);

  tabByLabel('订单').click(); await sleep(1300);
  steps.orders = /Test Order \\/ Test Spec/.test(document.body.innerText) && /ORD-7002/.test(document.body.innerText);
  steps.ordersLinked = /TASK-2003/.test(document.body.innerText);
  var quotes = document.querySelectorAll('.alims-card-quote');
  steps.quoteButtons = quotes.length;
  if (quotes.length) {
    var quote = quotes[0];
    quote.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    quote.click();
  }
  await sleep(300);
  steps.quoteInserted = /【引用 · /.test(inputActions._text);
  steps.quoteTitle = (inputActions._text.match(/【引用 · ([^】]+)】/) || [])[1] || null;

  // Selecting text inside a card must quote only that fragment.
  inputActions._text = '';
  var firstCard = document.querySelector('[data-card-id^="order-"]') || document.querySelector('.alims-order-card');
  var walker = firstCard ? document.createTreeWalker(firstCard, NodeFilter.SHOW_TEXT) : null;
  var textNode = null;
  while (walker && walker.nextNode()) {
    if (walker.currentNode.textContent.trim().length > 8) { textNode = walker.currentNode; break; }
  }
  if (textNode) {
    var range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(12, textNode.textContent.length));
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    firstCard.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(150);
    var scopedQuote = firstCard.querySelector('.alims-card-quote');
    steps.selectionArmed = Boolean(scopedQuote && /引用选中/.test(scopedQuote.textContent));
    if (scopedQuote) scopedQuote.click();
    await sleep(250);
    steps.selectionQuoted = /选中内容：「/.test(inputActions._text);
    steps.selectionOnly = /选中内容：「/.test(inputActions._text) && !/卡片内容：/.test(inputActions._text);
  }

  tabByLabel('影响').click(); await sleep(1100);
  steps.changePanel = /订单变更与影响分析/.test(document.body.innerText);
  var submit = Array.prototype.slice.call(document.querySelectorAll('button')).filter(function (b) { return b.textContent.indexOf('登记变更并分析影响') >= 0; })[0];
  if (submit) submit.click();
  await sleep(3000);
  steps.changeResult = /变更后/.test(document.body.innerText) && /LIMS-RULES/.test(document.body.innerText);

  tabByLabel('排程').click(); await sleep(1000);
  steps.schedule = /候选方案|当前方案|排程/.test(document.body.innerText);

  // Chat tool cards share the same quote bridge (tool.call.toolview props).
  var chatHost = document.createElement('div');
  chatHost.id = 'chat-host';
  document.body.appendChild(chatHost);
  var ToolView = registered['tool.call.toolview|lims_generate_plans'];
  steps.chatToolView = Boolean(ToolView);
  if (ToolView) {
    inputActions._text = '';
    ReactDOM.createRoot(chatHost).render(React.createElement(ToolView, {
      phase: 'result',
      toolName: 'lims_generate_plans',
      callId: 'call-1',
      inputActions: inputActions,
      block: { meta: {
        kind: 'plans',
        task: { id: 'TASK-2005', name: 'GC residual solvent test 残留溶剂检测' },
        plans: [{ id: 'PLAN-TASK-2005-1', strategyLabel: '最快完成', status: 'feasible', statusLabel: '可行', score: 86, startLabel: '10/28 10:00', endLabel: '10/29 12:00', dueMarginHours: 6, resources: { equipment: { name: 'GC GC-01 气相色谱' }, person: { name: 'Tester 03 王强' } } }],
        diagnostics: [],
      }, content: [] },
    }));
    await sleep(500);
    var chatQuote = chatHost.querySelector('.alims-tool-quote');
    steps.chatQuoteButton = Boolean(chatQuote);
    if (chatQuote) { chatQuote.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); chatQuote.click(); }
    await sleep(300);
    steps.chatQuoteInserted = /【引用 · 候选排程】/.test(inputActions._text);
  }

  steps.errors = window.__errors;
  var out = document.createElement('pre'); out.id = 'harness-result'; out.textContent = JSON.stringify(steps, null, 2); document.body.appendChild(out);
  document.title = 'DONE';
}
run().catch(function (error) {
  window.__errors.push('driver: ' + error.message + ' ' + error.stack);
  var out = document.createElement('pre'); out.id = 'harness-result'; out.textContent = JSON.stringify({ errors: window.__errors }, null, 2); document.body.appendChild(out);
});
</script></body></html>`;

const clientSource = await readFile(`${ROOT}/client.js`);
const react = await readFile(`${VENDOR}/react.js`);
const reactDom = await readFile(`${VENDOR}/react-dom.js`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/harness.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(harness);
      return;
    }
    if (url.pathname === '/client.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(clientSource);
      return;
    }
    if (url.pathname === '/vendor/react.js' || url.pathname === '/vendor/react-dom.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(url.pathname.endsWith('react-dom.js') ? reactDom : react);
      return;
    }
    if (url.pathname.startsWith('/api/lims/')) {
      const route = routes.find((entry) => entry.path === url.pathname && entry.methods.includes(req.method));
      if (!route) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'no route' }));
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const response = await route.fetch(
        new Request(`http://127.0.0.1${req.url}`, {
          method: req.method,
          headers: req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {},
          ...(body && req.method !== 'GET' ? { body } : {}),
        }),
      );
      const text = await response.text();
      res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(text);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  } catch (error) {
    console.error('server error', error);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(error) }));
  }
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const port = server.address().port;

/* Optional visual review: AGENTIC_LIMS_UI_SHOT=/tmp/shots renders one PNG per page. */
if (process.env.AGENTIC_LIMS_UI_SHOT) {
  const dir = process.env.AGENTIC_LIMS_UI_SHOT;
  await exec('mkdir', ['-p', dir]);
  for (const page of ['概览', '订单', '影响', '排程']) {
    await exec(
      chrome,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--no-first-run',
        `--user-data-dir=${process.env.TMPDIR ?? '/tmp'}/lims-ui-profile`,
        '--hide-scrollbars',
        '--window-size=420,1500',
        '--virtual-time-budget=8000',
        `--screenshot=${dir}/${page}.png`,
        `http://127.0.0.1:${port}/harness.html?only=${encodeURIComponent(page)}`,
      ],
      { maxBuffer: 20 * 1024 * 1024, timeout: 120000 },
    );
    console.log('shot', `${dir}/${page}.png`);
  }
  server.close();
  await db.dropDatabase();
  await client.close();
  process.exit(0);
}

const { stdout, stderr } = await exec(
  chrome,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    `--user-data-dir=${process.env.TMPDIR ?? '/tmp'}/lims-ui-profile`,
    '--hide-scrollbars',
    '--window-size=420,1400',
    '--virtual-time-budget=16000',
    '--dump-dom',
    `http://127.0.0.1:${port}/harness.html`,
  ],
  { maxBuffer: 40 * 1024 * 1024, timeout: 180000 },
);
if (stderr && /uncaught|exception|error/i.test(stderr)) console.error('chrome stderr:', stderr.slice(0, 1500));

const match = stdout.match(/<pre id="harness-result">([\s\S]*?)<\/pre>/);
server.close();
await db.dropDatabase();
await client.close();

if (!match) {
  console.log('ui render check FAILED: the harness produced no result');
  console.log((stdout.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
  console.log(stdout.slice(0, 2500));
  process.exit(1);
}
const decoded = match[1]
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>');
const result = JSON.parse(decoded);
console.log(JSON.stringify(result, null, 2));

const checks = [
  ['panel renders with the new 订单 tab', (result.nav || []).some((label) => label.includes('订单'))],
  ['dashboard renders', result.dashboard === true],
  ['sample readiness card renders', result.sampleCard === true],
  ['orders page renders order + spec', result.orders === true],
  ['orders page shows the inferred task link', result.ordersLinked === true],
  ['every card exposes a quote button', result.quoteButtons > 0],
  ['quote reaches the chat composer', result.quoteInserted === true],
  ['selecting text arms the quote button', result.selectionArmed === true],
  ['selection quote uses only the selected fragment', result.selectionQuoted === true && result.selectionOnly === true],
  ['impact page renders the change panel', result.changePanel === true],
  ['sample-delay change returns an analysis', result.changeResult === true],
  ['schedule page renders', result.schedule === true],
  ['chat tool card renders', result.chatToolView === true],
  ['chat tool card exposes a quote button', result.chatQuoteButton === true],
  ['chat tool card quotes into the composer', result.chatQuoteInserted === true],
  ['no runtime errors', (result.errors || []).length === 0],
];

let failures = 0;
for (const [label, ok] of checks) {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}
if ((result.errors || []).length) console.log('errors:', result.errors);
console.log(failures === 0 ? '\nui render check passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
