import { MongoClient } from 'mongodb';
import { buildRoutes } from '../lib/routes.js';
import { seedDatabase } from '../lib/seed.js';
const client = await MongoClient.connect('mongodb://127.0.0.1:27018');
const db = client.db('agentic_lims_test_demo');
await db.dropDatabase();
await seedDatabase(db, { force: true });
const routes = buildRoutes({ db, config: { demoNow: '2026-10-30T08:00:00+08:00' } });
const call = async (path, body) => {
  const [pathname, query = ''] = path.split('?');
  const route = routes.find((r) => r.path === pathname && r.methods.includes(body ? 'POST' : 'GET'));
  const res = await route.fetch(new Request(`http://x${pathname}${query ? `?${query}` : ''}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}));
  return { status: res.status, data: await res.json() };
};
const testPlan = await call('/api/lims/test-plan', { projectId: 'PRJ-1001', templateId: 'TPL-004', actor: 'demo' });
console.log('TEST PLAN', testPlan.status, testPlan.data.testPlan?.id, testPlan.data.testPlan?.summary);
for (const plan of testPlan.data.testPlan?.plans ?? []) console.log(' TP', plan.taskId, plan.startLabel, '->', plan.endLabel, plan.resources.equipment.name, plan.resources.person.name);
for (const taskId of ['TASK-2004', 'TASK-2006']) {
  const result = await call('/api/lims/plans', { taskId, actor: 'demo' });
  console.log('EXTRA', taskId, result.status, result.data.plans?.map((plan) => `${plan.id} ${plan.statusLabel} ${plan.startLabel}->${plan.endLabel} ${plan.resources.equipment.name} + ${plan.resources.person.name}`));
}
const schedule = await call('/api/lims/resource-schedule?weekStart=2026-10-27&weekCount=2');
console.log('SCHEDULE', schedule.status, schedule.data.summary);
for (const resource of schedule.data.resources) console.log(resource.kind, resource.name, resource.segments.map((segment) => `${segment.day} ${segment.taskId} ${segment.start}-${segment.end}`).join(' | '));
await db.dropDatabase();
await client.close();
