/**
 * 重新灌入演示数据，并把工作区停在一个可直接演示的状态。
 *
 * 数据口径已改为客户结构：SPEC → 规格活动 → PLAN 批次。
 *   - 待排活动：SA26AA4851-01（盐雾，AMPLITUDE）
 *   - 已预占：SA26AA4855-01（Pre-booked）
 *   - 设备阻塞：SA26AA4854-01（机械耐久台 EB-01 Maintenance Due）
 *   - 样品未到位：SA26AA4853-01（Instockdate 11-02）
 */
import { MongoClient } from 'mongodb';
import { buildRoutes } from '../lib/routes.js';

const client = await MongoClient.connect(process.env.AGENTIC_LIMS_MONGO_URI || 'mongodb://127.0.0.1:27018');
const db = client.db(process.env.AGENTIC_LIMS_DB || 'agentic_lims');
const routes = buildRoutes({ db, config: { demoNow: '2026-10-30T08:00:00+08:00' } });
const call = async (path, body) => {
  const [p, q] = path.split('?');
  const route = routes.find((r) => r.path === p && r.methods.includes(body ? 'POST' : 'GET'));
  if (!route) return { status: 404, data: { error: 'route not found' } };
  const res = await route.fetch(new Request(`http://x${p}${q ? `?${q}` : ''}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}));
  return { status: res.status, data: await res.json() };
};

const seeded = await call('/api/lims/seed', { force: true });
console.log('seed', seeded.status, JSON.stringify(seeded.data).slice(0, 160));
if (seeded.status !== 200) {
  await client.close();
  process.exit(1);
}

await db.collection('workspace').updateOne(
  { _id: 'default' },
  {
    $set: {
      revision: 1,
      page: 'dashboard',
      taskId: null,
      planIds: [],
      selectedPlanId: null,
      comparison: null,
      projectId: null,
      testPlanId: null,
      equipmentId: null,
      date: null,
      resourceId: null,
      message: '客户口径演示数据已载入（SPEC → 活动 → PLAN）。',
      source: 'system',
      updatedAt: new Date().toISOString(),
    },
  },
);

const downtime = await call('/api/lims/downtime', {
  equipmentId: 'EQPT25AA1101',
  date: '2026-10-29',
  reason: '计划维护（气候箱校准）',
  actor: 'demo',
});
console.log('downtime EQPT25AA1101 10-29', downtime.status);

// 测试计划留给 demo 现场生成（`lims_generate_test_plan`），这样周计划里的 Pre-booked / 分包
// 占用才会以真实状态显示，而不是被一个候选方案覆盖。

const plans = await call('/api/lims/plans', { taskId: 'SA26AA4851-01', actor: 'demo' });
console.log('plans SA26AA4851-01', plans.status, plans.data?.plans?.length ?? plans.data?.error ?? '');

for (const path of ['/api/lims/overview', '/api/lims/tasks', '/api/lims/specs', '/api/lims/projects', '/api/lims/orders', '/api/lims/policies', '/api/lims/resources', '/api/lims/week-plan?weeks=4']) {
  const res = await call(path);
  console.log(path, res.status, res.data?.error ? `ERR ${res.data.error}` : 'ok');
}

await db.collection('workspace').updateOne(
  { _id: 'default' },
  {
    $set: {
      page: 'schedule',
      taskId: 'SA26AA4851-01',
      planIds: plans.data?.plans?.map((plan) => plan.id) ?? [],
      selectedPlanId: plans.data?.plans?.[0]?.id ?? null,
      message: 'SA26AA4851-01 已有候选方案，尚未确认。',
      updatedAt: new Date().toISOString(),
    },
    $inc: { revision: 1 },
  },
);

const workspace = await db.collection('workspace').findOne({ _id: 'default' });
console.log('workspace', { page: workspace.page, taskId: workspace.taskId, planIds: workspace.planIds?.length ?? 0 });
await client.close();
