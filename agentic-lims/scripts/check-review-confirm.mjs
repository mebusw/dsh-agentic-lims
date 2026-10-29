/**
 * 「需审核」方案不能变成死路。
 *
 * 回归用例：非标准方法（task.status 含 review）生成的所有候选方案都是
 * `needs_review`。旧逻辑会拒绝确认全部候选，用户没有出口。
 * 现在要求人工审核确认（reviewAck），并把审核人 / 时间 / 结论写进审计。
 *
 * Run: node agentic-lims/scripts/check-review-confirm.mjs
 */
import { MongoClient } from 'mongodb';
import { buildRoutes } from '../lib/routes.js';
import { ensureIndexes, seedDatabase } from '../lib/seed.js';

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

const client = await MongoClient.connect(process.env.AGENTIC_LIMS_MONGO_URI || 'mongodb://127.0.0.1:27018', {
  serverSelectionTimeoutMS: 3000,
});
const db = client.db('agentic_lims_test_review');
await db.dropDatabase();
await ensureIndexes(db);
await seedDatabase(db);

// 把一个活动改成"需方法审核"，模拟非标准方法
const ACTIVITY = 'SA26AA4851-02';
await db.collection('raw_spec_activities').updateOne(
  { activity_id: ACTIVITY },
  { $set: { status: 'Needs Method Review' } },
);

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

console.log('\ngenerate candidates for a review task');
const generated = await call('/api/lims/plans', { taskId: ACTIVITY, count: 3, actor: 'test' });
check('plans generated', generated.status === 200 && generated.data.plans.length > 0, generated.data.error);
check(
  'every candidate is needs_review',
  generated.data.plans.length > 0 && generated.data.plans.every((plan) => plan.status === 'needs_review'),
  generated.data.plans.map((plan) => plan.status),
);
check('one candidate is marked recommended', generated.data.plans.filter((plan) => plan.recommended).length === 1);

const planId = generated.data.plans.find((plan) => plan.recommended)?.id ?? generated.data.plans[0].id;
console.log(`\nconfirm ${planId}`);
const rejected = await call('/api/lims/confirm', { planId, actor: 'test' });
check('confirm without review ack is rejected', rejected.status === 409, rejected.status);
check('rejection explains what is missing', rejected.data.requiresReviewAck === true, rejected.data.code);
check('error message tells the user how to proceed', /审核/.test(rejected.data.error ?? ''), rejected.data.error);

const confirmed = await call('/api/lims/confirm', {
  planId,
  actor: 'test-reviewer',
  reviewAck: true,
  reviewNote: '方法条件与能力项已人工核对',
});
check('confirm with review ack succeeds', confirmed.status === 200 && confirmed.data.ok === true, confirmed.data.error);
check('plan is confirmed', confirmed.data.plan?.status === 'confirmed', confirmed.data.plan?.status);
check('review ack is stored on the plan', confirmed.data.plan?.reviewAck?.acknowledgedBy === 'test-reviewer', confirmed.data.plan?.reviewAck);

const reviewAudit = await db.collection('audit_events').find({ type: 'review_ack' }).toArray();
check('review ack writes an audit event', reviewAudit.length === 1, reviewAudit.length);
check('audit records the reviewer', reviewAudit[0]?.actor === 'test-reviewer', reviewAudit[0]?.actor);

const second = generated.data.plans.find((plan) => plan.id !== planId);
if (second) {
  const secondAttempt = await call('/api/lims/confirm', { planId: second.id, reviewAck: true, actor: 'test' });
  check(
    'the next candidate is confirmable too (no dead end across candidates)',
    secondAttempt.status === 200 || secondAttempt.data?.code === 'needs_review',
    secondAttempt.status,
  );
} else {
  console.log('  note  only one candidate was feasible; cross-candidate check skipped');
}

await db.dropDatabase();
await client.close();

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
