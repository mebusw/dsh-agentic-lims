import { MongoClient } from 'mongodb';
import { buildRoutes } from '../lib/routes.js';
import { ensureIndexes, seedDatabase } from '../lib/seed.js';

const client = await MongoClient.connect('mongodb://127.0.0.1:27018', { serverSelectionTimeoutMS: 3000 });
const db = client.db('agentic_lims_downtime_confirm');
await db.dropDatabase();
await ensureIndexes(db);
await seedDatabase(db);
const routes = buildRoutes({ db, config: { demoNow: '2026-10-30T08:00:00+08:00' } });
const call = async (path, body) => {
  const [p, q] = path.split('?');
  const route = routes.find((r) => r.path === p);
  const res = await route.fetch(new Request(`http://x${p}${q ? `?${q}` : ''}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }));
  return { status: res.status, data: await res.json() };
};
const plans = await call('/api/lims/plans', { taskId: 'TASK-2001' });
const plan = plans.data.plans[0];
console.log('plan days before downtime', plan.segments.map(s => s.day));
await call('/api/lims/downtime', { equipmentId: 'EQ-007', date: '2026-10-27', reason: '计划维护' });
const confirmed = await call('/api/lims/confirm', { planId: plan.id });
console.log('confirm status', confirmed.status, confirmed.data.error, confirmed.data.conflicts);
await client.close();
