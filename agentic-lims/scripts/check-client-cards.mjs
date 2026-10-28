/**
 * Self-test for the answer-level chat cards (turn tail).
 *
 * Loads the real `client.js` under a stub client-plugin runtime: a fake module
 * loader, a minimal React (just `createElement` plus the hook names the module
 * destructures), a DOM shim for the injected stylesheet, and a recording Cordis
 * context. It then asserts that
 *
 *   1. the plugin registers a `conversation.chat.turnTail` card component,
 *   2. it registers the `lims-answer-cards` Turn Definition,
 *   3. the definition projects settled `lims_*` results against their Turn,
 *   4. the registered component renders one card per meta kind, up to three,
 *      and drops bare task lookups when a substantive card exists.
 *
 * Run: node agentic-lims/scripts/check-client-cards.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = resolve(here, '../client.js');

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

// ---------------------------------------------------------------- React shim
const element = (type, props, children) => ({ type, props: props ?? {}, children });

const react = {
  createElement: (type, props, ...children) => element(type, props, children.flat()),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
  useContext: (context) => context?._value ?? null,
  createContext: (value) => ({ _value: value, Provider: 'ContextProvider', Consumer: 'ContextConsumer' }),
  useId: () => 'test-id',
  isValidElement: (value) => Boolean(value) && typeof value === 'object' && 'type' in value,
  Fragment: 'Fragment',
};

// --------------------------------------------------------------- DOM shim
const document = {
  head: { appendChild: () => {} },
  createElement: () => ({ setAttribute: () => {}, remove: () => {}, style: {}, textContent: '' }),
  querySelector: () => null,
};
globalThis.document = document;

// ------------------------------------------------------- module loader shim
let plugin = null;
globalThis.window = {
  __AGENTIC_LIMS_TEST__: true,
  __ModuleLoader__: {
    load: ({ factory }) => {
      plugin = factory((request) => {
        if (request === 'react') return react;
        throw new Error(`unexpected require: ${request}`);
      });
    },
  },
};
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.clearTimeout = () => {};
globalThis.setTimeout = () => 0;

const source = readFileSync(clientPath, 'utf8');
// The module registers itself on load; evaluate it the way the browser would.
new Function('window', source)(globalThis.window);

console.log(`client.js: ${source.length} bytes`);

// ------------------------------------------------------------- Cordis shim
const registered = { slots: [], turnTail: [], definitions: [], tabTypes: [] };

function makeSubContext(services) {
  return {
    ...services,
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    inject: (names, callback) => {
      const available = {};
      let ready = true;
      for (const name of Array.isArray(names) ? names : [names]) {
        if (services[name] === undefined) ready = false;
        else available[name] = services[name];
      }
      if (ready) callback({ ...makeSubContext(services), ...available });
    },
  };
}

const context = {
  effect: (fn) => {
    const dispose = fn();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  inject: (names, callback) => {
    const available = {};
    let ready = true;
    for (const name of Array.isArray(names) ? names : [names]) {
      if (context[name] === undefined) ready = false;
      else available[name] = context[name];
    }
    if (ready) callback({ ...makeSubContext(context), ...available });
  },
  slots: {
    inject: (_name, callback) => callback(),
    register: (definition, component) => {
      registered.slots.push({ name: definition.name, key: definition.key, id: definition.id, component });
      return () => {};
    },
  },
  uiConversation: {
    events: {
      register: (definition) => {
        registered.definitions.push(definition);
        return () => {};
      },
    },
  },
  sidebarRightTabs: {
    register: (definition) => {
      registered.tabTypes.push(definition);
      return () => {};
    },
  },
  sidebarRight: {
    mounted: { getSnapshot: () => null, subscribe: () => () => {} },
    openTab: () => {},
  },
};

console.log('\nplugin wiring');
check('module exports a client plugin', plugin !== null && typeof plugin.apply === 'function');
plugin.apply(context);

const turnTail = registered.slots.find((entry) => entry.name === 'conversation.chat.turnTail');
check('registers conversation.chat.turnTail', turnTail !== undefined);
check('turn tail has a stable id', turnTail?.id === '@local/agentic-lims-answer-cards', turnTail?.id);
check('registers one Turn Definition', registered.definitions.length === 1, registered.definitions.length);
check('definition kind is lims-answer-cards', registered.definitions[0]?.kind === 'lims-answer-cards', registered.definitions[0]?.kind);
const internals = globalThis.window.__agenticLimsTest;
check('exposes the reference helpers for tests', Boolean(internals && internals.buildReference && internals.quoteIntoChat));
check('registers one tool view per lims tool', registered.slots.filter((entry) => entry.name === 'tool.call.toolview').length === internals.LIMS_TOOL_NAMES.length, registered.slots.filter((entry) => entry.name === 'tool.call.toolview').length);
check('includes the chapter-14 tools', ['lims_list_orders', 'lims_get_order', 'lims_analyze_change', 'lims_list_policies'].every((name) => internals.LIMS_TOOL_NAMES.includes(name)));

// --------------------------------------------------------- quote references
console.log('\ncard -> chat references');
const reference = internals.buildReference({
  title: '候选方案 TASK-2005',
  lines: ['TASK-2005 GC residual solvent test', 'PLAN-TASK-2005-1 2026-10-28 10:00 → 2026-10-29 12:00'],
  selection: '  EQ-005  +  P-002  ',
  prompt: '请解释为什么不是 P-003。',
});
check('reference starts with a stable header', reference.startsWith('【引用 · 候选方案 TASK-2005】'), reference.split('\n')[0]);
check('reference keeps the structured facts', reference.includes('- TASK-2005 GC residual solvent test') && reference.includes('- PLAN-TASK-2005-1'));
check('reference normalises the selected text', reference.includes('选中内容：「EQ-005 + P-002」'), reference);
check('reference keeps the follow-up prompt', reference.trimEnd().endsWith('请解释为什么不是 P-003。'));

const wholeCard = internals.buildReference({ title: '订单 ORD-7002', text: '  ORD-7002\n\n  Urgent   ·  10/28  ' });
check('whole-card quote collapses whitespace', wholeCard.includes('卡片内容：ORD-7002 Urgent · 10/28'), wholeCard);

let inserted = '';
const fakeInput = {
  captureInsertion: () => ({ rev: 1, start: 0, end: 0 }),
  insertText: (text) => {
    inserted = text;
    return true;
  },
};
const quoted = internals.quoteIntoChat(fakeInput, { title: '任务 TASK-2005', lines: ['Urgent'] });
check('quote inserts into the composer', quoted.ok === true && inserted.startsWith('【引用 · 任务 TASK-2005】') && inserted.endsWith('\n'), inserted);

let draft = '';
const fallback = internals.quoteIntoChat({ setDraft: (text) => { draft = text; } }, { title: '兜底', lines: ['x'] });
check('quote falls back to setDraft', fallback.ok === true && draft.includes('【引用 · 兜底】'), draft);
check('quote without an editor fails safely', internals.quoteIntoChat(null, { title: 'x' }).ok === false);

// ------------------------------------------------------- projection fixtures
const definition = registered.definitions[0];

const event = (type, seq, data, surfaceOp) => ({ type, seq, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) });
const turnEvent = (turn) => event('turn/start', 1, { turn });
const callEvent = (turn, callId, name, seq) => event('tool/call', seq, { turn, callId, name, arguments: '{}', step: 1 });
const resultEvent = (turn, callId, meta, seq) => event('tool/result', seq, { turn, step: 1, meta, message: { role: 'tool', source: { callId }, isError: false, content: [] } }, 'append');

function project(events) {
  let state;
  let lastSeq = 0;
  for (const item of events) {
    const match = definition.match(item);
    if (!match) continue;
    match.event = item;
    state = match.role === 'start' ? definition.start({ state }, match) : definition.update({ state }, match);
    lastSeq = item.seq;
  }
  const location = definition.buildLocationData({ state }, 'turn', null);
  return {
    location,
    owner: {
      turn: { turn: state?.turn, data: new Map(location === null ? [] : [[location.key, location.value]]), end: { seq: lastSeq } },
      seq: lastSeq,
    },
  };
}

const lookupsOnly = [turnEvent(3), callEvent(3, 'c1', 'lims_get_task', 2), resultEvent(3, 'c1', { kind: 'task', task: { id: 'TASK-2005' } }, 3)];
const fiveCards = [
  turnEvent(1),
  callEvent(1, 'a', 'lims_list_tasks', 2),
  resultEvent(1, 'a', { kind: 'tasks', tasks: [] }, 3),
  callEvent(1, 'b', 'lims_get_task', 4),
  resultEvent(1, 'b', { kind: 'task', task: {} }, 5),
  callEvent(1, 'c', 'lims_generate_plans', 6),
  resultEvent(1, 'c', { kind: 'plans', plans: [] }, 7),
  callEvent(1, 'd', 'lims_confirm_plan', 8),
  resultEvent(1, 'd', { kind: 'confirm', plan: {} }, 9),
  callEvent(1, 'e', 'lims_explain_resource', 10),
  resultEvent(1, 'e', { kind: 'resource', usable: false }, 11),
  callEvent(1, 'f', 'lims_equipment_bookings', 12),
  resultEvent(1, 'f', { kind: 'bookings', count: 3 }, 13),
];
const noisyEvents = [
  turnEvent(2),
  callEvent(2, 'g', 'lims_generate_plans', 2),
  resultEvent(2, 'g', { kind: 'plans', plans: [] }, 3),
  event('tool/result', 4, { turn: 2, step: 1, meta: { kind: 'error' }, message: { role: 'tool', source: { callId: 'g' }, isError: true, content: [] } }, 'append'),
  { type: 'tool/result', seq: 5, data: { turn: 2, step: 1, meta: { kind: 'plans' }, message: { role: 'tool', source: { callId: 'g' }, isError: false, content: [] } } },
  event('turn/end', 6, { turn: 2 }),
];

/** Render the registered component with the fake React and read the card list back. */
function renderCards(owner) {
  const tree = turnTail.component(owner);
  if (tree === null) return [];
  return tree.children.map((child) => ({ key: child.props.key, toolName: child.props.toolName, kind: child.props.block.meta.kind }));
}

console.log('\nprojection and selection');
const lookups = project(lookupsOnly);
check('a lone task lookup still yields a card', lookups.location?.value.cards.length === 1);
check('lone task card renders', renderCards(lookups.owner).length === 1);

const many = project(fiveCards);
check('projects every settled lims result', many.location?.value.cards.length === 6, many.location?.value.cards.length);
const manyCards = renderCards(many.owner);
check('caps the answer at three cards', manyCards.length === 3, manyCards.length);
check('keeps settlement order', manyCards.map((card) => card.kind).join(',') === 'confirm,resource,bookings', manyCards.map((card) => card.kind).join(','));
check('drops task lookups when richer cards exist', !manyCards.some((card) => card.kind === 'task' || card.kind === 'tasks'));

const noisy = project(noisyEvents);
const noisyCards = renderCards(noisy.owner);
check('ignores error results', noisyCards.length === 1, noisyCards.length);
check('ignores replacement (non-append) results', noisy.location?.value.cards.length === 1, noisy.location?.value.cards.length);

const empty = project([turnEvent(4), event('turn/end', 2, { turn: 4 })]);
check('no lims call means no card', empty.location?.value.cards.length === 0);
check('no card renders as null', turnTail.component(empty.owner) === null);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
