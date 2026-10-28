/**
 * Chapter-14 upgrade self-test.
 *
 * Verifies the deterministic parts of the upgrade without DSH:
 *   - TestOrder / TestSpecification projection with visible, unconfirmed links
 *   - sample readiness as hard constraint HC-007
 *   - Task Type reservation policy HC-008 (Prebook exclusive)
 *   - ChangeEvent + direct/indirect impact analysis for sample / due / priority
 *   - raw CSV rows stay untouched when an override is applied
 *
 * Run: node agentic-lims/scripts/check-upgrade.mjs
 */
import { MongoClient } from 'mongodb';
import { createEngineContext, generatePlans } from '../lib/engine.js';
import { buildRoutes } from '../lib/routes.js';
import { ensureIndexes, loadDomain, seedDatabase } from '../lib/seed.js';

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

const client = await MongoClient.connect(process.env.AGENTIC_LIMS_MONGO_URI || 'mongodb://127.0.0.1:27018', {
  serverSelectionTimeoutMS: 3000,
});
const db = client.db('agentic_lims_test_upgrade');
await db.dropDatabase();
await ensureIndexes(db);
await seedDatabase(db);

const routes = buildRoutes({ db, config: { demoNow: '2026-10-27T08:00:00+08:00' } });
const call = async (path, body) => {
  const [pathname, query] = path.split('?');
  const route = routes.find((entry) => entry.path === pathname && entry.methods.includes(body ? 'POST' : 'GET'));
  if (!route) throw new Error(`missing route ${pathname}`);
  const res = await route.fetch(
    new Request(`http://x${pathname}${query ? `?${query}` : ''}`, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  );
  return { status: res.status, data: await res.json() };
};

console.log('\nseed');
check('prototype_config seeded', (await db.collection('prototype_config').countDocuments()) === 1);
check('sample_status seeded for every task', (await db.collection('sample_status').countDocuments()) === 8);

console.log('\ndomain projection');
const domain = await loadDomain(db);
check('tasks carry a Task Type', domain.tasks.every((task) => Boolean(task.taskType)));
check('TASK-2001 is Prebook exclusive', domain.taskById.get('TASK-2001').taskTypeRule.exclusive === true);
check('TASK-2005 sample is not in stock yet', domain.taskById.get('TASK-2005').sample.status === 'Not in stock');
check('TASK-2005 ready time is the expected arrival', domain.taskById.get('TASK-2005').sample.readyAt === '2026-10-28T02:00:00.000Z', domain.taskById.get('TASK-2005').sample.readyAt);

console.log('\norders and specs');
const orders = await call('/api/lims/orders');
check('orders route ok', orders.status === 200 && orders.data.ok === true);
check('12 test orders derived', orders.data.orders?.length === 12, orders.data.orders?.length);
const ord7002 = orders.data.orders.find((order) => order.id === 'ORD-7002');
check('urgent order exposes its spec + sample', Boolean(ord7002?.specs?.[0]?.id === 'REQ-1002' && ord7002.sample));
check('order links are labelled as prototype inference', /原型/.test(ord7002?.specs?.[0]?.linkBasis ?? ''), ord7002?.specs?.[0]?.linkBasis);
check('unlinked project tasks stay visible', (orders.data.unlinkedTasks ?? []).length >= 1, orders.data.unlinkedTasks?.length);
const orderDetail = await call('/api/lims/order?orderId=ORD-7002');
check('order detail finds the linked task', orderDetail.data.order?.tasks?.[0]?.id === 'TASK-2003', orderDetail.data.order?.tasks?.[0]?.id);
check('order detail reports the policy version', /LIMS-RULES/.test(orderDetail.data.policy?.ruleVersion ?? ''), orderDetail.data.policy?.ruleVersion);

console.log('\npolicies');
const policies = await call('/api/lims/policies');
check('policies route ok', policies.data.ok === true);
check('policies are flagged unconfirmed', policies.data.confirmed === false);
check('three Task Type rules', Object.keys(policies.data.taskTypeRules ?? {}).length === 3);
check('sample policy blocks testing before arrival', policies.data.samplePolicy?.requireInStockBeforeTest === true);

console.log('\nHC-007 sample readiness');
const ctx = createEngineContext(domain, new Date('2026-10-27T08:00:00+08:00'));
const task2005 = domain.taskById.get('TASK-2005');
const plans2005 = generatePlans(ctx, task2005, { count: 1 });
const plan2005 = plans2005.plans[0];
check('TASK-2005 has a feasible plan after sample arrival', Boolean(plan2005));
check(
  'no segment starts before the sample-ready date',
  (plan2005?.segments ?? []).every((segment) => segment.day >= '2026-10-28'),
  (plan2005?.segments ?? []).map((segment) => segment.day),
);
const firstDaySegment = (plan2005?.segments ?? []).find((segment) => segment.day === '2026-10-28');
check(
  'a sample-ready-day segment starts at/after 10:00',
  !firstDaySegment || firstDaySegment.startMin >= 600,
  firstDaySegment,
);
const hc007 = plan2005?.evaluations?.find((item) => item.constraintId === 'HC-007');
check('HC-007 is evaluated and passes', hc007?.result === 'pass', hc007);
check('HC-007 carries rule id and evidence', hc007?.ruleId === 'SAMPLE-READY' && Boolean(hc007?.evidence));

console.log('\nHC-008 Task Type reservation');
const task2001 = domain.taskById.get('TASK-2001');
const plans2001 = generatePlans(ctx, task2001, { count: 1 });
const plan2001 = plans2001.plans[0];
check('Prebook plan is marked exclusive', plan2001?.reservation?.mode === 'exclusive', plan2001?.reservation);
const otherEq007Days = new Set(
  domain.allocations
    .filter((row) => row.resourceId === 'EQ-007' && row.taskId !== 'TASK-2001')
    .map((row) => row.date),
);
check(
  'Prebook plan avoids days already booked on EQ-007',
  (plan2001?.segments ?? []).every((segment) => !otherEq007Days.has(segment.day)),
  (plan2001?.segments ?? []).map((segment) => segment.day),
);
check('HC-008 is evaluated', plan2001?.evaluations?.some((item) => item.constraintId === 'HC-008'));

console.log('\nchange event: sample delay');
const delay = await call('/api/lims/change-impact', {
  type: 'sample_delay',
  taskId: 'TASK-2005',
  value: '2026-10-31',
  reason: '样品批次延期',
});
check('sample delay route ok', delay.status === 200 && delay.data.ok === true, delay.data.error);
check('direct impact points at the changed task', delay.data.direct?.taskId === 'TASK-2005');
check('schedule no longer starts before 10/31', (delay.data.direct?.after?.startAt ?? '').slice(0, 10) >= '2026-10-31', delay.data.direct?.after?.startAt);
check('direct impact is flagged late', delay.data.direct?.late === true);
check('summary counts the affected tasks', delay.data.summary?.affected >= 1, delay.data.summary);
const events = await call('/api/lims/change-events');
check('ChangeEvent persisted', (events.data.events ?? []).some((event) => event.type === 'sample_delay' && event.taskId === 'TASK-2005'));
check('workspace switched to the impact page', delay.data.workspace?.page === 'impact');

console.log('\nchange event: due date and priority');
const dueChange = await call('/api/lims/change-impact', { type: 'due_date', taskId: 'TASK-2003', value: '2026-10-29' });
check('due date change recorded', dueChange.data.change?.to === '2026-10-29', dueChange.data.change);
const priorityChange = await call('/api/lims/change-impact', { type: 'priority', taskId: 'TASK-2004', value: 'Urgent' });
check('priority change recorded', priorityChange.data.change?.from === 'Normal' && priorityChange.data.change?.to === 'Urgent');

console.log('\nraw data stays immutable');
const rawTask2003 = await db.collection('raw_tasks').findOne({ _id: 'TASK-2003' });
const rawTask2004 = await db.collection('raw_tasks').findOne({ _id: 'TASK-2004' });
check('raw_tasks due date unchanged', rawTask2003?.due_date === '2026-11-04', rawTask2003?.due_date);
check('raw_tasks priority unchanged', rawTask2004?.priority === 'Normal', rawTask2004?.priority);
const afterDomain = await loadDomain(db);
check('override applied to the domain', afterDomain.taskById.get('TASK-2003').dueDate.toISOString().slice(0, 10) === '2026-10-28', afterDomain.taskById.get('TASK-2003').dueDate.toISOString());
check('override is visible on the task', (afterDomain.taskById.get('TASK-2004').overriddenFields ?? []).includes('priority'));

console.log('\naudit');
const audit = await call('/api/lims/audit');
check('change events are audited', (audit.data.events ?? []).some((event) => event.type === 'change_registered'));

await db.dropDatabase();
await client.close();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
