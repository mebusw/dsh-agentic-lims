/**
 * Rule layer for the customer-shaped dataset.
 *
 * Chapter 14 of the old README assumed `task → order` and a `Task Type`
 * reservation rule. The customer's export shows something different:
 *
 *   - the schedulable object is a SPEC, gated by a 10-state status machine;
 *   - `Workload` is 0 everywhere, so effort must come from the standard activity;
 *   - `Pre-booked` is a STATUS, not a reservation rule;
 *   - `Instockdate` is a real column, so sample readiness is a fact, not an
 *     assumption (assumptions are only a fallback and stay `confirmed: false`).
 *
 * Everything below is configuration-driven (`data/lab_rules.json`) and marked
 * `confirmed: false` until the business owner signs it off.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffHours, formatDate, formatDateTime, parseInstant, priorityRank, round1 } from './util.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const SAMPLE_LABELS = {
  'In stock': '样品已到位',
  'Partially in stock': '部分到样',
  'Not in stock': '样品未到位',
  Unknown: '样品状态待确认',
};

const SAMPLE_TONES = {
  'In stock': 'ok',
  'Partially in stock': 'warn',
  'Not in stock': 'error',
  Unknown: 'idle',
};

let cachedDefaults = null;

/** Bundled defaults; the DB copy (`lab_rules`) always wins over this file. */
export function defaultUpgradeConfig() {
  if (!cachedDefaults) {
    const text = readFileSync(join(HERE, '..', 'data', 'lab_rules.json'), 'utf8');
    cachedDefaults = JSON.parse(text);
  }
  return cachedDefaults;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch === undefined ? base : patch;
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    output[key] = isPlainObject(value) && isPlainObject(base?.[key]) ? deepMerge(base[key], value) : value;
  }
  return output;
}

/**
 * Merge a stored configuration document over the bundled defaults.
 * @param {object|null} doc - `lab_rules` document, or null for defaults.
 */
export function normalizeUpgradeConfig(doc) {
  const merged = deepMerge(defaultUpgradeConfig(), doc ?? {});
  const states = Array.isArray(merged.statusMachine?.states) ? merged.statusMachine.states : [];
  return {
    id: merged._id ?? 'lab-rules-v1',
    version: merged.version ?? '2026.10.29',
    ruleVersion: merged.ruleVersion ?? 'LIMS-RULES-2026.10.29',
    policyVersion: merged.policyVersion ?? 'LAB-POLICY-2026.10.29',
    confirmed: merged.confirmed === true,
    disclaimer: merged.disclaimer ?? '',
    labPolicy: merged.labPolicy ?? {},
    statusMachine: {
      ...(merged.statusMachine ?? {}),
      states,
      schedulableStatuses:
        merged.statusMachine?.schedulableStatuses ??
        states.filter((state) => state.schedulable).map((state) => state.code),
    },
    reservationModes: merged.reservationModes ?? {},
    defaultReservationMode: merged.defaultReservationMode ?? 'Shared',
    reservationOverrides: merged.reservationOverrides ?? {},
    competencyPolicy: merged.competencyPolicy ?? {},
    samplePolicy: merged.samplePolicy ?? {},
    calendarPolicy: merged.calendarPolicy ?? {},
    priorityScale: merged.priorityScale ?? {},
    durationPolicy: merged.durationPolicy ?? {},
    weekSequencing: merged.weekSequencing ?? {},
    samples: merged.samples ?? {},
  };
}

/**
 * Resolve one activity's sample readiness.
 *
 * Priority: the SPEC's `Instockdate` (a real column) → a stored override
 * (`sample_status`, written by a sample-delay ChangeEvent) → a bundled
 * assumption. Unknown is always reported as unknown, never as "ready".
 */
export function resolveSample(task, config) {
  const base =
    task.sample ??
    (task.spec
      ? {
          status: task.spec.instockDate ? 'In stock' : 'Unknown',
          readyAt: task.spec.instockDate?.toISOString() ?? null,
          source: 'spec-export',
          confirmed: false,
          note: '',
        }
      : {
          status: 'Unknown',
          readyAt: null,
          source: 'missing',
          confirmed: false,
          note: '没有关联 spec，无法判断样品',
        });

  const override = config.samples?.[task.id] ?? config.samples?.[task.specId] ?? null;
  const mergedRaw = override ? { ...base, ...override } : base;

  const actual = mergedRaw.actualInStockAt ? parseInstant(mergedRaw.actualInStockAt) : null;
  const expected = mergedRaw.expectedInStockAt ? parseInstant(mergedRaw.expectedInStockAt) : mergedRaw.readyAt ? parseInstant(mergedRaw.readyAt) : null;
  const readyAt = actual ?? expected;
  const status = mergedRaw.status ?? 'Unknown';
  const inStock = status === 'In stock';
  const partial = status === 'Partially in stock';
  const blocked = status === 'Not in stock' && !readyAt;
  return {
    status,
    statusLabel: SAMPLE_LABELS[status] ?? status,
    tone: SAMPLE_TONES[status] ?? 'idle',
    required: mergedRaw.required ?? null,
    available: mergedRaw.available ?? null,
    readyAt: readyAt?.toISOString() ?? null,
    expectedInStockAt: expected?.toISOString() ?? null,
    actualInStockAt: actual?.toISOString() ?? null,
    inStock,
    partial,
    blocked,
    needsConfirmation: status === 'Unknown',
    confirmed: mergedRaw.confirmed === true,
    source: override ? override.source ?? 'sample_status' : mergedRaw.source ?? 'spec-export',
    note: override?.note ?? mergedRaw.note ?? '',
  };
}

/** Reservation rule for a task. `Pre-booked` is a status and must not be confused with `Prebook`. */
export function resolveReservationMode(task, config) {
  const mode = task.reservationMode ?? config.defaultReservationMode ?? 'Shared';
  const rule =
    config.reservationModes?.[mode] ?? {
      label: mode,
      exclusive: false,
      shareable: true,
      description: '未配置的预约模式，按可共享但需人工确认处理。',
    };
  const override = config.reservationOverrides?.[task.id] ?? null;
  return {
    mode,
    label: rule.label ?? mode,
    reason: override?.reason ?? rule.description ?? '',
    source: override ? 'config' : 'spec-status',
    confirmed: override?.confirmed === true,
    rule,
  };
}

/** Backwards-compatible alias: the old engine/tools called this "task type". */
export function resolveTaskType(task, config) {
  const resolved = resolveReservationMode(task, config);
  return {
    type: resolved.mode,
    label: resolved.label,
    reason: resolved.reason,
    source: resolved.source,
    confirmed: resolved.confirmed,
    rule: resolved.rule,
  };
}

/** Attach rule-layer fields (sample, reservation mode, orders) to the domain. */
export function applyUpgrade(domain, config) {
  for (const task of domain.tasks) {
    const reservation = resolveReservationMode(task, config);
    task.taskType = reservation.mode;
    task.taskTypeLabel = reservation.label;
    task.taskTypeReason = reservation.reason;
    task.taskTypeSource = reservation.source;
    task.taskTypeConfirmed = reservation.confirmed;
    task.taskTypeRule = reservation.rule;
    task.reservationMode = reservation.mode;
    task.sample = resolveSample(task, config);
    task.sampleReadyAt = task.sample.readyAt;
    const spec = domain.specById?.get(task.specId) ?? null;
    task.orderIds = spec?.orderNo ? [spec.orderNo] : [];
    task.specIds = spec ? [spec.id] : [];
  }
  domain.config = config;
  domain.ruleVersion = config.ruleVersion;
  domain.policyVersion = config.policyVersion;
  domain.orders = deriveOrders(domain, config);
  domain.orderById = new Map(domain.orders.map((order) => [order.id, order]));
  domain.unlinkedTasks = domain.tasks.filter((task) => task.orderIds.length === 0);
  domain.unlinkedSpecs = domain.specs.filter((spec) => !spec.orderNo);
  return domain;
}

/** Hours from the frozen clock until the sample is ready (negative = already ready). */
export function sampleLeadHours(sample, now) {
  if (!sample?.readyAt) return null;
  return round1(diffHours(sample.readyAt, now));
}

function specActivityPayload(domain, spec) {
  const activities = spec.activityIds
    .map((id) => domain.specActivities.find((activity) => activity.id === id))
    .filter(Boolean);
  const tasks = activities.map((activity) => domain.taskById.get(activity.id)).filter(Boolean);
  return { activities, tasks };
}

/**
 * Build `Order` / `Spec` projections.
 *
 * Unlike the earlier prototype, the spec → order link is NOT guessed: the
 * planning grid carries an `Order` column per line and we keep that value. A
 * spec without an order number stays unlinked instead of being attached by
 * title similarity (customer titles repeat in 48% of rows).
 */
export function deriveOrders(domain, config) {
  const byOrder = new Map();
  for (const spec of domain.specs) {
    if (!spec.orderNo) continue;
    if (!byOrder.has(spec.orderNo)) {
      byOrder.set(spec.orderNo, {
        id: spec.orderNo,
        source: '排程回填表 Order 列（客户 LIMS 导出里没有该字段）',
        specs: [],
        priority: spec.priority.value,
        dueAt: spec.windowEnd?.toISOString() ?? null,
        sampleCount: 0,
      });
    }
    const order = byOrder.get(spec.orderNo);
    const { activities, tasks } = specActivityPayload(domain, spec);
    const template = spec.standards.length ? domain.templates.find((item) => item.methodCode === spec.standards[0]) ?? null : null;
    const sample = domain.sampleForSpec(spec);
    order.specs.push({
      id: spec.id,
      orderId: spec.orderNo,
      templateId: template?.id ?? null,
      templateName: template?.name ?? spec.standards.join(' / ') ?? null,
      methodCode: template?.methodCode ?? spec.standards[0] ?? null,
      name: spec.title ?? spec.id,
      title: spec.title,
      status: spec.status,
      statusLabel: spec.statusLabel,
      lifecycle: spec.phase,
      priority: spec.priority.value,
      priorityCode: spec.priority.code,
      requestedAt: spec.createdAt?.toISOString() ?? null,
      dueAt: spec.windowEnd?.toISOString() ?? null,
      dueLabel: spec.windowEnd ? formatDateTime(spec.windowEnd) : null,
      windowLabel:
        spec.windowStart && spec.windowEnd ? `${formatDate(spec.windowStart)}–${formatDate(spec.windowEnd)}` : null,
      sampleCount: spec.sampleCount,
      sample,
      summary: [spec.originOfNeed, spec.standards.join(' / ')].filter(Boolean).join(' · '),
      ruleStatus: spec.schedulable ? 'Approved' : spec.status,
      standards: spec.standards,
      competencyCheck: spec.competencyCheck,
      activityIds: activities.map((activity) => activity.id),
      linkedTaskIds: tasks.map((task) => task.id),
      linkedTaskId: tasks[0]?.id ?? null,
      linkedTaskName: tasks[0]?.name ?? null,
      linkConfidence: 'exact',
      linkBasis: `Order 列 ${spec.orderNo} 直接关联 SPEC ${spec.id}（不靠名称推断）`,
      site: spec.site,
    });
    order.sampleCount += spec.sampleCount ?? 0;
    if (!order.dueAt || (spec.windowEnd && spec.windowEnd.toISOString() < order.dueAt)) {
      order.dueAt = spec.windowEnd?.toISOString() ?? order.dueAt;
    }
    if (priorityRank(spec.priority.value) < priorityRank(order.priority)) order.priority = spec.priority.value;
  }

  const orders = [...byOrder.values()]
    .map((order) => {
      const specs = order.specs;
      const linked = specs.filter((spec) => spec.linkedTaskIds.length > 0);
      const pending = specs.filter((spec) => !spec.linkedTaskIds.length);
      const sample = linked[0]?.sample ?? specs[0]?.sample ?? null;
      const status =
        pending.length > 0 && linked.length === 0
          ? 'needs_task'
          : specs.some((spec) => spec.status === 'In approval' || spec.status === 'Draft')
            ? 'needs_review'
            : 'ready_to_plan';
      return {
        ...order,
        dueLabel: order.dueAt ? formatDateTime(order.dueAt) : null,
        linkedTaskIds: linked.flatMap((spec) => spec.linkedTaskIds),
        sample,
        status,
        statusLabel: status === 'needs_review' ? '含未审批 SPEC' : status === 'needs_task' ? '无可排活动' : '可排程',
        linkNote: 'Order 与 SPEC 的关联取自排程回填表的 Order 列；LIMS 导出本身没有订单号，缺失时留空而不推断。',
      };
    })
    .sort(
      (first, second) =>
        priorityRank(first.priority) - priorityRank(second.priority) ||
        String(first.dueAt ?? '').localeCompare(String(second.dueAt ?? '')),
    );

  return orders;
}

/** Compact order payload for the orders page and the chat card. */
export function orderSummary(order, domain) {
  const tasks = (order.linkedTaskIds ?? []).map((id) => domain.taskById.get(id)).filter(Boolean);
  return {
    id: order.id,
    source: order.source,
    priority: order.priority,
    priorityCode: order.specs?.[0]?.priorityCode ?? null,
    dueAt: order.dueAt,
    dueLabel: order.dueLabel,
    sampleCount: order.sampleCount,
    status: order.status,
    statusLabel: order.statusLabel,
    sample: order.sample,
    specs: (order.specs ?? []).map((spec) => ({
      id: spec.id,
      name: spec.name,
      templateId: spec.templateId,
      templateName: spec.templateName,
      methodCode: spec.methodCode,
      sampleCount: spec.sampleCount,
      priority: spec.priority,
      status: spec.status,
      statusLabel: spec.statusLabel,
      dueLabel: spec.dueLabel,
      windowLabel: spec.windowLabel,
      ruleStatus: spec.ruleStatus,
      standards: spec.standards,
      competencyCheck: spec.competencyCheck,
      activityIds: spec.activityIds,
      linkedTaskId: spec.linkedTaskId,
      linkedTaskIds: spec.linkedTaskIds,
      linkedTaskName: spec.linkedTaskName,
      linkConfidence: spec.linkConfidence,
      linkBasis: spec.linkBasis,
      sample: spec.sample,
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      name: task.name,
      specId: task.specId,
      projectId: task.projectId,
      projectName: task.projectName,
      priority: task.priority,
      priorityCode: task.priorityCode,
      dueLabel: task.dueDate ? formatDateTime(task.dueDate) : '—',
      effortHours: task.effortHours,
      effortSource: task.effortSource,
      taskType: task.taskType,
      sample: task.sample,
    })),
    linkNote: order.linkNote,
  };
}

/** Rules the UI / agent may cite; everything is versioned and marked unconfirmed. */
export function policyPayload(config) {
  return {
    ruleVersion: config.ruleVersion,
    policyVersion: config.policyVersion,
    confirmed: config.confirmed,
    disclaimer: config.disclaimer,
    lab: config.labPolicy,
    sites: config.labPolicy?.sites ?? [],
    samplePolicy: config.samplePolicy,
    statusMachine: config.statusMachine,
    reservationModes: config.reservationModes,
    // Legacy key kept so the current sidebar keeps rendering until the UI pass.
    taskTypeRules: config.reservationModes,
    defaultReservationMode: config.defaultReservationMode,
    competencyPolicy: config.competencyPolicy,
    calendarPolicy: config.calendarPolicy,
    priorityScale: config.priorityScale,
    durationPolicy: config.durationPolicy,
    weekSequencing: config.weekSequencing,
    taskTypeAssignments: Object.entries(config.reservationOverrides).map(([taskId, entry]) => ({
      taskId,
      type: entry.mode,
      reason: entry.reason,
      confirmed: entry.confirmed === true,
    })),
  };
}
