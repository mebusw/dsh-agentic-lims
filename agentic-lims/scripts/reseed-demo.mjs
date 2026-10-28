import { MongoClient } from 'mongodb';
import { buildRoutes } from '../lib/routes.js';

const client = await MongoClient.connect(process.env.AGENTIC_LIMS_MONGO_URI || 'mongodb://127.0.0.1:27018');
const db = client.db(process.env.AGENTIC_LIMS_DB || 'agentic_lims');
const routes = buildRoutes({ db, config: { demoNow: '2026-10-27T08:00:00+08:00' } });
const call = async (path, body) => {
  const [p, q] = path.split('?');
  const route = routes.find((r) => r.path === p && r.methods.includes(body ? 'POST' : 'GET'));
  const res = await route.fetch(new Request(`http://x${p}${q ? `?${q}` : ''}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}));
  return { status: res.status, data: await res.json() };
};
console.log('seed', await call('/api/lims/seed', { force: true }));
await db.collection('workspace').updateOne({ _id: 'default' }, { $set: {
  revision: 1, page: 'dashboard', taskId: null, planIds: [], selectedPlanId: null, comparison: null,
  projectId: null, testPlanId: null, equipmentId: null, date: null, resourceId: null,
  message: '演示数据已重新载入（中文名称版）。', source: 'system', updatedAt: new Date().toISOString(),
} });
console.log('downtime 10/27', (await call('/api/lims/downtime', { equipmentId: 'EQ-007', date: '2026-10-27', reason: '连续维护', actor: 'demo' })).status);
console.log('downtime 10/28', (await call('/api/lims/downtime', { equipmentId: 'EQ-007', date: '2026-10-28', reason: '计划维护', actor: 'demo' })).status);
console.log('test plan', (await call('/api/lims/test-plan', { projectId: 'PRJ-1001', templateId: 'TPL-004', actor: 'demo' })).status);
console.log('plans TASK-2005', (await call('/api/lims/plans', { taskId: 'TASK-2005', actor: 'demo' })).status);
await db.collection('workspace').updateOne({ _id: 'default' }, { $set: { page: 'schedule', taskId: 'TASK-2005', message: '中文演示数据已就绪。', updatedAt: new Date().toISOString() }, $inc: { revision: 1 } });
const w = await db.collection('workspace').findOne({ _id: 'default' });
console.log('workspace', { page: w.page, planIds: w.planIds, projectId: w.projectId, testPlanId: w.testPlanId });
await client.close();
