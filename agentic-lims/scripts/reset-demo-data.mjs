/**
 * 把演示库恢复到初始状态：
 * - 重新导入 seed 数据（清空 raw_*、plans、test_plans、audit_events、downtime_events、task_template_overrides）
 * - 工作区回到概览页
 *
 * 与 scripts/reseed-demo.mjs 的区别：不预生成停机、测试计划和候选方案，
 * 方便在客户面前从"零方案"开始跑完整 demo 流程。
 */
import { MongoClient } from 'mongodb';
import { seedDatabase } from '../lib/seed.js';

const client = await MongoClient.connect(process.env.AGENTIC_LIMS_MONGO_URI || 'mongodb://127.0.0.1:27018');
const db = client.db(process.env.AGENTIC_LIMS_DB || 'agentic_lims');

const result = await seedDatabase(db, { force: true });
console.log('seed', result);

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
      orderId: null,
      changeId: null,
      message: '演示数据已恢复到初始状态（无历史方案、无停机登记）。',
      source: 'system',
      updatedAt: new Date().toISOString(),
    },
  },
  { upsert: true },
);

const counts = {
  tasks: await db.collection('raw_tasks').countDocuments(),
  plans: await db.collection('plans').countDocuments(),
  testPlans: await db.collection('test_plans').countDocuments(),
  downtime: await db.collection('downtime_events').countDocuments(),
  audit: await db.collection('audit_events').countDocuments(),
};
console.log('counts', counts);
await client.close();
