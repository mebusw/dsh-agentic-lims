/**
 * MongoDB seed + access helpers.
 * The raw CSV rows are the system of record: they are stored verbatim in
 * `raw_*` collections and rebuilt into the domain on demand. Plans, audit events
 * and the shared agent workspace are first-class collections.
 */
import { loadRawDataset } from './csv.js';
import { buildDomain } from './model.js';
import { formatDateTime } from './util.js';

export const RAW_COLLECTIONS = {
  resources: 'raw_resources',
  persons: 'raw_persons',
  equipment: 'raw_equipment',
  templates: 'raw_templates',
  requests: 'raw_requests',
  tasks: 'raw_tasks',
  activities: 'raw_activities',
  assignments: 'raw_assignments',
  allocations: 'raw_allocations',
  history: 'raw_history',
  candidates: 'raw_candidates',
  constraints: 'raw_constraints',
};

const ID_FIELDS = {
  resources: 'resource_id',
  persons: 'person_id',
  equipment: 'equipment_id',
  templates: 'template_id',
  requests: 'request_id',
  tasks: 'task_id',
  activities: 'activity_id',
  assignments: 'assignment_id',
  allocations: 'allocation_id',
  history: 'history_id',
  candidates: 'plan_id',
  constraints: 'constraint_id',
};

function stripMongo(doc) {
  const { _id, ...rest } = doc;
  return rest;
}

export async function readRawDataset(db) {
  const entries = await Promise.all(
    Object.entries(RAW_COLLECTIONS).map(async ([key, collection]) => {
      const rows = await db.collection(collection).find({}, { projection: { _id: 0 } }).toArray();
      return [key, rows];
    }),
  );
  return Object.fromEntries(entries);
}

export async function loadDomain(db) {
  const raw = await readRawDataset(db);
  const overrides = await db.collection('task_template_overrides').find({}).toArray();
  const mapping = Object.fromEntries(overrides.map((item) => [item._id, item.templateId]));
  return buildDomain(raw, mapping);
}

export async function ensureIndexes(db) {
  await Promise.all([
    db.collection('raw_allocations').createIndex({ task_id: 1, allocation_date: 1 }),
    db.collection('raw_allocations').createIndex({ resource_id: 1, allocation_date: 1 }),
    db.collection('plans').createIndex({ planId: 1 }, { unique: true }),
    db.collection('plans').createIndex({ taskId: 1, generatedAt: -1 }),
    db.collection('test_plans').createIndex({ projectId: 1, createdAt: -1 }),
    db.collection('audit_events').createIndex({ at: -1 }),
  ]);
}

export async function seedDatabase(db, { force = false } = {}) {
  const meta = await db.collection('meta').findOne({ _id: 'seed' });
  if (meta && !force) return { seeded: false, version: meta.version };
  if (force) {
    await Promise.all([
      ...Object.values(RAW_COLLECTIONS).map((collection) => db.collection(collection).deleteMany({})),
      db.collection('plans').deleteMany({}),
      db.collection('test_plans').deleteMany({}),
      db.collection('audit_events').deleteMany({}),
      db.collection('downtime_events').deleteMany({}),
      db.collection('task_template_overrides').deleteMany({}),
    ]);
  }
  const raw = await loadRawDataset();
  for (const [key, collection] of Object.entries(RAW_COLLECTIONS)) {
    const idField = ID_FIELDS[key];
    const docs = raw[key].map((row) => ({ _id: row[idField] || undefined, ...row }));
    if (docs.length > 0) {
      await db.collection(collection).insertMany(docs, { ordered: false }).catch((error) => {
        if (error?.code !== 11000) throw error;
      });
    }
  }
  await ensureIndexes(db);
  const version = '2026-10-27.1';
  await db.collection('meta').updateOne(
    { _id: 'seed' },
    { $set: { version, seededAt: new Date().toISOString(), source: 'LIMS排程原型-模拟数据包' } },
    { upsert: true },
  );
  await db.collection('workspace').updateOne(
    { _id: 'default' },
    {
      $setOnInsert: {
        revision: 1,
        page: 'dashboard',
        taskId: null,
        planIds: [],
        selectedPlanId: null,
        message: '演示数据已载入。可以向右侧对话提出排程需求，或直接浏览工作台。',
        source: 'system',
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
  await addAudit(db, {
    type: 'seed',
    actor: 'system',
    summary: '模拟数据包已导入 MongoDB',
    detail: `载入 ${raw.tasks.length} 个任务、${raw.equipment.length} 个设备/空间、${raw.persons.length} 名人员、${raw.allocations.length} 条负荷记录。`,
  });
  await addAudit(db, {
    type: 'clock',
    actor: 'system',
    summary: '演示时钟已冻结',
    detail: '原型固定使用 2026-10-27 08:00 作为当前时间，保证模拟数据与排程结果可复现。',
  });
  return { seeded: true, version };
}

const DOWNTIME_COLLECTION = 'downtime_events';

export async function readDowntime(db, { from, to } = {}) {
  const filter = {};
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = from;
    if (to) filter.date.$lte = to;
  }
  return db.collection(DOWNTIME_COLLECTION).find(filter, { projection: { _id: 0 } }).sort({ date: 1 }).toArray();
}

export async function addDowntime(db, { equipmentId, date, reason = '', actor = 'workspace' }) {
  const id = `DT-${equipmentId}-${date}`;
  const doc = {
    id,
    equipmentId,
    date,
    reason,
    actor,
    createdAt: new Date().toISOString(),
  };
  await db.collection(DOWNTIME_COLLECTION).updateOne({ _id: id }, { $set: doc }, { upsert: true });
  return doc;
}

export async function removeDowntime(db, { equipmentId, date }) {
  const id = `DT-${equipmentId}-${date}`;
  const result = await db.collection(DOWNTIME_COLLECTION).deleteOne({ _id: id });
  return result.deletedCount > 0;
}

export async function addAudit(db, event) {
  const doc = {
    id: `AUD-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    type: event.type ?? 'action',
    actor: event.actor ?? 'system',
    summary: event.summary ?? '',
    detail: event.detail ?? '',
    taskId: event.taskId ?? null,
    planId: event.planId ?? null,
    resourceId: event.resourceId ?? null,
    data: event.data ?? null,
  };
  await db.collection('audit_events').insertOne({ _id: doc.id, ...doc });
  return doc;
}

export async function readAudit(db, limit = 40) {
  return db
    .collection('audit_events')
    .find({}, { projection: { _id: 0 } })
    .sort({ at: -1 })
    .limit(limit)
    .toArray();
}

let lastWorkspaceTouch = 0;

export async function readWorkspace(db) {
  if (Date.now() - lastWorkspaceTouch > 5000) {
    lastWorkspaceTouch = Date.now();
    db.collection('meta')
      .updateOne(
        { _id: 'diagnostics' },
        { $set: { lastWorkspaceReadAt: new Date().toISOString() }, $inc: { workspaceReads: 1 } },
        { upsert: true },
      )
      .catch(() => {});
  }
  const doc = await db.collection('workspace').findOne({ _id: 'default' });
  if (!doc) {
    return {
      revision: 1,
      page: 'dashboard',
      taskId: null,
      planIds: [],
      selectedPlanId: null,
      message: '工作区尚未初始化。',
      source: 'system',
      updatedAt: new Date().toISOString(),
    };
  }
  const { _id, ...rest } = doc;
  return rest;
}

export async function writeWorkspace(db, patch) {
  const current = await readWorkspace(db);
  const next = {
    ...current,
    ...patch,
    revision: (current.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  await db.collection('workspace').updateOne({ _id: 'default' }, { $set: next }, { upsert: true });
  return next;
}

export async function savePlans(db, plans) {
  if (!plans || plans.length === 0) return;
  const docs = plans.map((plan) => ({ _id: plan.id, planId: plan.id, ...plan }));
  // Keep plan versions for before/after comparison instead of overwriting history.
  await db.collection('plans').updateMany(
    { taskId: plans[0].taskId, status: { $nin: ['confirmed', 'superseded'] } },
    { $set: { status: 'superseded', supersededAt: new Date().toISOString() } },
  );
  await db.collection('plans').insertMany(docs, { ordered: false }).catch((error) => {
    if (error?.code !== 11000) throw error;
  });
}

export async function saveTestPlan(db, testPlan) {
  if (!testPlan) return null;
  const doc = { _id: testPlan.id, testPlanId: testPlan.id, ...testPlan };
  await db.collection('test_plans').insertOne(doc);
  return testPlan;
}

export async function readTestPlans(db, projectId) {
  const filter = projectId ? { projectId } : {};
  return db
    .collection('test_plans')
    .find(filter, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
}

export async function readTestPlan(db, testPlanId) {
  return db.collection('test_plans').findOne({ testPlanId }, { projection: { _id: 0 } });
}

export async function readActivePlans(db, limit = 120) {
  return db
    .collection('plans')
    .find({ status: { $ne: 'superseded' } }, { projection: { _id: 0 } })
    .sort({ generatedAt: -1 })
    .limit(limit)
    .toArray();
}

export async function readPlansForTask(db, taskId, limit = 8) {
  return db
    .collection('plans')
    .find({ taskId }, { projection: { _id: 0 } })
    .sort({ generatedAt: -1 })
    .limit(limit)
    .toArray();
}

export async function readPlan(db, planId) {
  return db.collection('plans').findOne({ planId }, { projection: { _id: 0 } });
}

export async function readPlansByIds(db, planIds) {
  if (!planIds || planIds.length === 0) return [];
  return db
    .collection('plans')
    .find({ planId: { $in: planIds } }, { projection: { _id: 0 } })
    .toArray();
}

export async function readRecentPlans(db, limit = 6) {
  return db
    .collection('plans')
    .find({}, { projection: { _id: 0 } })
    .sort({ generatedAt: -1 })
    .limit(limit)
    .toArray();
}

export function describePlan(plan) {
  const start = plan.startAt ? formatDateTime(plan.startAt) : '—';
  const end = plan.endAt ? formatDateTime(plan.endAt) : '—';
  return `${plan.strategyLabel ?? plan.strategy ?? '候选方案'}：${start} → ${end}，${plan.resources?.equipment?.name ?? '—'} + ${plan.resources?.person?.name ?? '—'}`;
}
