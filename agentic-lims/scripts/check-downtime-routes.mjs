import { MongoClient } from 'mongodb';
import { buildRoutes } from '../lib/routes.js';
import { ensureIndexes, seedDatabase } from '../lib/seed.js';

const client = await MongoClient.connect('mongodb://127.0.0.1:27018', { serverSelectionTimeoutMS: 3000 });
const db = client.db('agentic_lims_downtime_test');
await db.dropDatabase();
await ensureIndexes(db);
await seedDatabase(db);
const routes = buildRoutes({ db, config: { demoNow: '2026-10-30T08:00:00+08:00' } });
const call = async (path, body, method) => {
  const [p, q] = path.split('?');
  const route = routes.find((r) => r.path === p);
  const res = await route.fetch(new Request(`http://x${p}${q ? `?${q}` : ''}`, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }));
  const data = await res.json();
  console.log(`\n=== ${method || (body ? 'POST' : 'GET')} ${path} -> ${res.status}`);
  return data;
};
const before = await call('/api/lims/impact?equipmentId=EQ-007&date=2026-10-27');
console.log('before', before.impact?.summary, before.impact?.tasks?.[0]?.recommended?.startLabel);
const down = await call('/api/lims/downtime', { equipmentId: 'EQ-007', date: '2026-10-27', reason: '计划维护' });
console.log('down summary', down.impact?.summary);
console.log('recommended', down.impact?.tasks?.[0]?.recommended?.startLabel, down.impact?.tasks?.[0]?.recommended?.segments?.map(s => s.day));
console.log('workspace', down.workspace?.page, down.workspace?.equipmentId, down.workspace?.date);
const plans = await call('/api/lims/plans', { taskId: 'TASK-2001' });
console.log('plans', plans.plans?.map(p => ({ id: p.id, start: p.startAt, days: p.segments.map(s => s.day) })));
const first = plans.plans?.[0];
if (first) {
  const confirmed = await call('/api/lims/confirm', { planId: first.id });
  console.log('confirm', confirmed.ok, confirmed.error || confirmed.plan?.status);
}
const removed = await call('/api/lims/downtime?equipmentId=EQ-007&date=2026-10-27', undefined, 'DELETE');
console.log('removed', removed.removed);
const after = await call('/api/lims/impact?equipmentId=EQ-007&date=2026-10-27');
console.log('after', after.impact?.summary);
await client.close();
