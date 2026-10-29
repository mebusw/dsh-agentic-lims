import { MongoClient } from 'mongodb';
import { buildRoutes } from '../lib/routes.js';
import { ensureIndexes, seedDatabase } from '../lib/seed.js';

const client = await MongoClient.connect('mongodb://127.0.0.1:27018', { serverSelectionTimeoutMS: 3000 });
const db = client.db('agentic_lims_revision_test');
await db.dropDatabase();
await ensureIndexes(db);
await seedDatabase(db);
const routes = buildRoutes({ db, config: { demoNow: '2026-10-30T08:00:00+08:00' } });
const call = async (path, body, method) => {
  const [p, q] = path.split('?');
  const route = routes.find((r) => r.path === p);
  const res = await route.fetch(new Request(`http://x${p}${q ? `?${q}` : ''}`, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }));
  return { status: res.status, data: await res.json() };
};
const first = await call('/api/lims/plans', { taskId: 'TASK-2005', count: 3 });
console.log('first plans', first.data.plans.map(p => p.id));
const oldPlan = first.data.plans[0];
const revise = await call('/api/lims/plans', {
  taskId: 'TASK-2005',
  previousPlanId: oldPlan.id,
  avoidFridayAfternoon: true,
  preferredEquipmentId: 'EQ-005',
});
console.log('revise status', revise.status);
console.log('new plans', revise.data.plans.map(p => p.id));
console.log('comparison', {
  before: revise.data.comparison?.before?.id,
  after: revise.data.comparison?.after?.id,
  completionDeltaHours: revise.data.comparison?.completionDeltaHours,
  scoreDelta: revise.data.comparison?.scoreDelta,
  resourceChanges: revise.data.comparison?.resourceChanges,
  daysAdded: revise.data.comparison?.daysAdded,
  daysRemoved: revise.data.comparison?.daysRemoved,
});
const oldDoc = await db.collection('plans').findOne({ planId: oldPlan.id });
console.log('old status', oldDoc?.status);
const confirmOld = await call('/api/lims/confirm', { planId: oldPlan.id });
console.log('confirm old', confirmOld.status, confirmOld.data.code, confirmOld.data.error);
const confirmNew = await call('/api/lims/confirm', { planId: revise.data.plans[0].id });
console.log('confirm new', confirmNew.status, confirmNew.data.ok, confirmNew.data.plan?.status);
const plansInDb = await db.collection('plans').find({ taskId: 'TASK-2005' }, { projection: { planId: 1, status: 1 } }).toArray();
console.log('plans in db', plansInDb);
await client.close();
