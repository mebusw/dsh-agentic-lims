/**
 * 客户口径数据模型自测。
 *
 * 校验的是“结构”而不是某个具体方案：
 *   - SPEC / 规格活动 / PLAN / 能力目录 / 标准 / 站点 能否正确归一化
 *   - 状态准入（HC-101）与计划窗口（HC-102）是否真的挡住了不该排的 spec
 *   - 样品到位是否读自 Instockdate（而不是原型假设）
 *   - 工时是否来自标准（客户 Workload 恒 0）
 *   - 能力校验 OFF 是否真的跳过，预约模式是否按 spec 状态分流
 *   - 引擎与路由在新 ID 上是否可用
 *
 * Run: node agentic-lims/scripts/check-customer-model.mjs
 */
import { MongoClient } from 'mongodb';
import { loadRawDataset } from '../lib/csv.js';
import { buildDomain, personCandidatesForTask, specLifecycle, taskReadiness } from '../lib/model.js';
import { createEngineContext, generatePlans } from '../lib/engine.js';
import { buildRoutes } from '../lib/routes.js';
import { ensureIndexes, seedDatabase } from '../lib/seed.js';

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

console.log('\nraw dataset');
const raw = await loadRawDataset();
check('19 specs', raw.specs.length === 19, raw.specs.length);
check('17 spec activities', raw.specActivities.length === 17, raw.specActivities.length);
check('4 PLAN batches', raw.plans.length === 4, raw.plans.length);
check('8 competencies', raw.competencies.length === 8, raw.competencies.length);
check('4 standards / 9 activity steps', new Set(raw.standards.map((row) => row.standard_id)).size === 4 && raw.standards.length === 9);

console.log('\ndomain projection');
const domain = buildDomain(raw);
check('every schedulable spec with a window becomes tasks', domain.tasks.length === 11, domain.tasks.length);
check('no task without a due date (HC-102)', domain.tasks.every((task) => task.dueDate instanceof Date));
check('no task from a non-schedulable status (HC-101)', domain.tasks.every((task) => task.spec.schedulable));
check('Approved spec without window stays out of the pool', !domain.taskById.has('SA26AA3506-01'));
check('In approval spec stays out of the pool', !domain.specs.find((spec) => spec.id === 'SPEC26AA3161').schedulable);
check('test_execution rows are records, not bookings', !domain.taskById.has('SA26AA4781-02'));

console.log('\neffort comes from the standard, not from Workload');
check('all customer workloads are 0', domain.specs.every((spec) => spec.workloadHours === 0));
check('task effort resolved from standard activity', domain.tasks.filter((task) => task.effortSource === 'standard').length === 9);
check('subcontract effort resolved from the activity row', domain.taskById.get('SUBS26AA0720-01').effortSource === 'activity');
check('day-labelled activity keeps its elapsed duration', domain.taskById.get('SA26AA4851-01').durationLabel === '1d');

console.log('\nsamples read from Instockdate');
const s4853 = domain.taskById.get('SA26AA4853-01');
check('future instock date marks the sample as not in stock', s4853.sample.status === 'Not in stock', s4853.sample.status);
check(
  'instock date is the ready time',
  s4853.sample.readyAt === domain.specById.get('SPEC26AA4853').instockDate.toISOString(),
  s4853.sample.readyAt,
);
check('sample source is the export, not an assumption', s4853.sample.source === 'spec-export', s4853.sample.source);

console.log('\ncompetency + reservation rules');
check('competency_check=OFF drops the hard requirement', domain.taskById.get('SA26AA4854-01').requirements.competencyIds.length === 0);
check('competency_check=ON keeps the standard competency', domain.taskById.get('SA26AA4851-03').requirements.competencyIds[0] === 'COMP-ELEC-LASER');
check('Pre-booked spec is exclusive', domain.taskById.get('SA26AA4855-01').reservationMode === 'Exclusive');
check('SUBS spec is subcontracted', domain.taskById.get('SUBS26AA0720-01').reservationMode === 'Subcontracted');
const voltaCandidates = domain.persons.filter((person) => person.site === 'VOLTA');
const voltaTask = domain.taskById.get('SA26AA4853-01');
const voltaPersons = personCandidatesForTask(domain, voltaTask).map((entry) => entry.person.site);
check('site isolation keeps VOLTA tasks on VOLTA people', voltaPersons.length > 0 && voltaPersons.every((site) => site === 'VOLTA'), voltaPersons);
check('VOLTA pool is smaller than the whole lab', voltaCandidates.length < domain.persons.length);

console.log('\nstatus machine + constraints');
check('11 status states configured', domain.config.statusMachine.states.length === 11, domain.config.statusMachine.states.length);
check('Draft is not schedulable', domain.config.statusMachine.states.find((state) => state.code === 'Draft').schedulable === false);
check('18 constraints in the rule book', domain.constraints.length === 18, domain.constraints.length);
check('every constraint is unconfirmed', domain.constraints.every((constraint) => constraint.confirmed === false));
check('rules are marked unconfirmed', domain.config.confirmed === false);
check('priority alias Routine maps to Normal', domain.specs.find((spec) => spec.id === 'SPEC26AA3954').priority.value === 'Normal');

console.log('\nengine');
const ctx = createEngineContext(domain, new Date('2026-10-30T08:00:00+08:00'));
const feasible = generatePlans(ctx, domain.taskById.get('SA26AA4851-01'), { count: 2 });
check('salt mist activity gets a candidate plan', feasible.plans.length > 0 && feasible.plans[0].feasible === true);
check('plan never starts before the sample is ready', feasible.plans.every((plan) => plan.startAt >= '2026-10-27T16:00:00.000Z'));
const blocked = generatePlans(ctx, domain.taskById.get('SA26AA4854-01'), { count: 1 });
check('maintenance-due equipment blocks the activity', blocked.plans.length === 0);
check('blocked diagnostic names the equipment', blocked.diagnostics.some((item) => /EB-01/.test(item.text)), blocked.diagnostics.map((item) => item.text));
check('readiness matches the engine', taskReadiness(domain, domain.taskById.get('SA26AA4854-01')).state === 'blocked');

console.log('\nhttp routes + seed');
const client = await MongoClient.connect(process.env.AGENTIC_LIMS_MONGO_URI || 'mongodb://127.0.0.1:27018', {
  serverSelectionTimeoutMS: 3000,
});
const db = client.db('agentic_lims_test_customer_model');
await db.dropDatabase();
await ensureIndexes(db);
const seeded = await seedDatabase(db);
check('seed wrote raw collections', (await db.collection('raw_specs').countDocuments()) === 19);
check('standards keep one doc per activity step', (await db.collection('raw_standards').countDocuments()) === 9);
check('lab_rules document seeded', (await db.collection('lab_rules').countDocuments()) === 1);
const reseeded = await seedDatabase(db);
check('seed is idempotent', reseeded.seeded === false);

const routes = buildRoutes({ db, config: { demoNow: '2026-10-30T08:00:00+08:00' } });
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

const specs = await call('/api/lims/specs');
check('specs route lists all 19', specs.data.specs?.length === 19, specs.data.specs?.length);
check('specs route reports the schedulable split', specs.data.summary?.schedulable === 8, specs.data.summary?.schedulable);
const notSchedulable = specs.data.specs.filter((spec) => !spec.lifecycle.schedulable);
check('每一行不可排都带原因', notSchedulable.every((spec) => spec.lifecycle.reasons.length > 0));

const one = await call('/api/lims/spec?specId=SPEC26AA4851');
check('spec detail lists its activities', one.data.spec?.activities?.length === 3, one.data.spec?.activities?.length);
check('spec detail exposes the PLAN batch', one.data.plan?.planNo === 'PLAN26AA1126-1');

const batches = await call('/api/lims/plan-batches');
check('plan batches route ok', batches.status === 200 && batches.data.plans?.length === 4);
check('PLAN groups its SPECs', batches.data.plans.find((plan) => plan.planNo === 'PLAN26AA1129-1')?.specs?.length === 2);

const orders = await call('/api/lims/orders');
check('orders keep the Order column link', orders.data.orders?.length >= 10, orders.data.orders?.length);
check('spec → order link is exact, not inferred', orders.data.orders.every((order) => order.specs.every((spec) => spec.linkConfidence === 'exact')));

const policies = await call('/api/lims/policies');
check('policies expose the status machine', policies.data.statusMachine?.states?.length === 11);
check('policies expose reservation modes', Object.keys(policies.data.reservationModes ?? {}).length === 3);

const overview = await call('/api/lims/overview');
check('overview still builds', overview.status === 200 && overview.data.stats?.totalTasks === 11, overview.data.stats?.totalTasks);

console.log('\ndemo data reset');
const generated = await call('/api/lims/plans', { taskId: 'SA26AA4851-01', count: 2, actor: 'test' });
check('a plan exists before the reset', generated.data.plans?.length > 0);
const resetPlans = await call('/api/lims/reset', { scope: 'plans', actor: 'test' });
check('reset plans clears candidates', resetPlans.status === 200 && (await db.collection('plans').countDocuments()) === 0, resetPlans.data.cleared);
const resetTask = await call('/api/lims/reset', { scope: 'task', targetId: 'SA26AA4851-01', actor: 'test' });
check('reset task accepts an activity id', resetTask.status === 200 && resetTask.data.ok === true, resetTask.data.error);
const resetSpec = await call('/api/lims/reset', { scope: 'spec', targetId: 'SPEC26AA4851', actor: 'test' });
check('reset spec accepts a spec id', resetSpec.status === 200, resetSpec.data.error);
const resetDowntime = await call('/api/lims/reset', { scope: 'downtime', actor: 'test' });
check('reset downtime ok', resetDowntime.status === 200);
const resetAll = await call('/api/lims/reset', { scope: 'all', actor: 'test' });
check('reset all reseeds the initial dataset', resetAll.status === 200 && resetAll.data.reseeded === true);
check('after reset all: 19 specs / 17 activities', (await db.collection('raw_specs').countDocuments()) === 19 && (await db.collection('raw_spec_activities').countDocuments()) === 17);
check('after reset all: no plans left', (await db.collection('plans').countDocuments()) === 0);
check('unknown reset scope is rejected', (await call('/api/lims/reset', { scope: 'nope' })).status === 400);

await client.close();

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
