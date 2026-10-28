/**
 * Upgrade layer for 《README-升级版》第 14 章.
 *
 * Chapter 14 separates `Test Order` from `Test Specification` and `Test Task`,
 * makes sample readiness a first-class scheduling input, and treats the
 * `Task Type` reservation rule (Prebook / Test Spec) as laboratory policy
 * rather than a universal "one task per slot" rule.
 *
 * The bundled project CSV has no foreign key from a task to an order, and no
 * sample-in-stock column at all. Instead of inventing those facts silently, this
 * module:
 *
 *   1. keeps every assumption in `data/prototype_upgrade.json` with
 *      `source: "prototype-assumption"` and `confirmed: false`;
 *   2. derives order → spec → task links only when the template matches and the
 *      due dates are close, and labels the result as a prototype inference that
 *      a TL must confirm;
 *   3. leaves unlinked orders/tasks visible instead of fabricating a mapping.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffHours, formatDateTime, parseInstant, priorityRank, round1 } from './util.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Prototype inference is only offered inside this due-date distance. */
const ORDER_LINK_MAX_DAYS = 21;

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

/** Bundled prototype defaults; the DB copy always wins over this file. */
export function defaultUpgradeConfig() {
  if (!cachedDefaults) {
    const text = readFileSync(join(HERE, '..', 'data', 'prototype_upgrade.json'), 'utf8');
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
 * Merge a stored configuration document over the bundled defaults and fill the
 * fields the rest of the host relies on.
 * @param {object|null} doc - `prototype_config` document, or null for defaults.
 */
export function normalizeUpgradeConfig(doc) {
  const merged = deepMerge(defaultUpgradeConfig(), doc ?? {});
  const taskTypeRules = { ...(merged.taskTypeRules ?? {}) };
  return {
    id: merged._id ?? 'upgrade-v1',
    version: merged.version ?? '2026.10.28',
    ruleVersion: merged.ruleVersion ?? 'LIMS-RULES-2026.10.28',
    policyVersion: merged.policyVersion ?? 'LAB-POLICY-2026.10.28',
    confirmed: merged.confirmed === true,
    disclaimer: merged.disclaimer ?? '',
    labPolicy: merged.labPolicy ?? {},
    samplePolicy: merged.samplePolicy ?? {},
    taskTypeRules,
    taskTypes: merged.taskTypes ?? {},
    samples: merged.samples ?? {},
  };
}

/**
 * Resolve one task's sample readiness. `readyAt` is the earliest instant the
 * engine may start actual testing: the actual in-stock time when known, then the
 * expected one. Unknown statuses are surfaced as warnings, never as "ready".
 * @param {string} taskId
 * @param {object} config - normalized upgrade config
 */
export function resolveSample(taskId, config) {
  const raw = config.samples?.[taskId] ?? null;
  if (!raw) {
    return {
      status: 'Unknown',
      statusLabel: SAMPLE_LABELS.Unknown,
      tone: SAMPLE_TONES.Unknown,
      required: null,
      available: null,
      readyAt: null,
      expectedInStockAt: null,
      actualInStockAt: null,
      inStock: false,
      partial: false,
      blocked: false,
      confirmed: false,
      source: 'missing',
      note: '模拟数据包没有样品到位信息，需要 TL 补充后才可判断。',
    };
  }
  const actual = raw.actualInStockAt ? parseInstant(raw.actualInStockAt) : null;
  const expected = raw.expectedInStockAt ? parseInstant(raw.expectedInStockAt) : null;
  const readyAt = actual ?? expected;
  const status = raw.status ?? 'Unknown';
  const inStock = status === 'In stock';
  const partial = status === 'Partially in stock';
  const blocked = status === 'Not in stock' && !readyAt;
  return {
    status,
    statusLabel: SAMPLE_LABELS[status] ?? status,
    tone: SAMPLE_TONES[status] ?? 'idle',
    required: raw.required ?? null,
    available: raw.available ?? null,
    readyAt: readyAt?.toISOString() ?? null,
    expectedInStockAt: expected?.toISOString() ?? null,
    actualInStockAt: actual?.toISOString() ?? null,
    inStock,
    partial,
    blocked,
    confirmed: raw.confirmed === true,
    source: raw.source ?? 'prototype-assumption',
    note: raw.note ?? '',
  };
}

/**
 * Resolve the task type and its reservation rule. An explicit assignment wins;
 * otherwise non-standard (needs-review) tasks are typed conservatively and
 * everything else is treated as a Test Spec.
 */
export function resolveTaskType(task, config) {
  const explicit = config.taskTypes?.[task.id];
  const reviewLike = /review/i.test(String(task.status ?? '')) || task.status === 'Needs Method Review';
  const type = explicit?.type || (reviewLike ? 'Non-standard validation' : 'Test Spec');
  const rule = config.taskTypeRules?.[type] ?? {
    label: type,
    exclusive: false,
    shareable: true,
    description: '未配置的 Task Type，按可共享但需人工确认处理。',
  };
  return {
    type,
    label: rule.label ?? type,
    reason: explicit?.reason ?? (reviewLike ? '任务状态为需方法审核' : '未显式配置 Task Type，按测试规范处理'),
    source: explicit ? 'config' : 'derived',
    confirmed: explicit?.confirmed === true,
    rule,
  };
}

/** Attach upgrade fields (task type, sample readiness, orders) to the domain. */
export function applyUpgrade(domain, config) {
  for (const task of domain.tasks) {
    const taskType = resolveTaskType(task, config);
    task.taskType = taskType.type;
    task.taskTypeLabel = taskType.label;
    task.taskTypeReason = taskType.reason;
    task.taskTypeSource = taskType.source;
    task.taskTypeConfirmed = taskType.confirmed;
    task.taskTypeRule = taskType.rule;
    task.sample = resolveSample(task.id, config);
    task.sampleReadyAt = task.sample.readyAt;
    task.orderIds = [];
    task.specIds = [];
  }
  domain.config = config;
  domain.ruleVersion = config.ruleVersion;
  domain.policyVersion = config.policyVersion;
  domain.orders = deriveOrders(domain, config);
  domain.orderById = new Map(domain.orders.map((order) => [order.id, order]));
  for (const order of domain.orders) {
    for (const spec of order.specs) {
      if (!spec.linkedTaskId) continue;
      const task = domain.taskById.get(spec.linkedTaskId);
      if (!task) continue;
      task.orderIds.push(order.id);
      task.specIds.push(spec.id);
    }
  }
  domain.unlinkedTasks = domain.tasks.filter((task) => task.orderIds.length === 0);
  return domain;
}

/** Hours from the frozen clock until the sample is ready (negative = already ready). */
export function sampleLeadHours(sample, now) {
  if (!sample?.readyAt) return null;
  return round1(diffHours(sample.readyAt, now));
}

function daysBetweenDates(first, second) {
  return Math.abs(diffHours(second, first) / 24);
}

/**
 * Build `TestOrder` / `TestSpecification` projections.
 *
 * A request is one `TestSpecification` (the mock data keeps a 1:1 order/spec
 * ratio). A spec is linked to at most one existing task by template and due-date
 * proximity, because the bundled project CSV has no order foreign key. The link
 * is marked `confidence: 'prototype-inference'` so neither the UI nor the agent
 * can present it as a confirmed relationship.
 */
export function deriveOrders(domain, config) {
  const claimedTasks = new Set();
  const specs = [];

  const requests = [...domain.requests].sort(
    (first, second) =>
      priorityRank(first.priority) - priorityRank(second.priority) ||
      (first.dueAt?.getTime() ?? 0) - (second.dueAt?.getTime() ?? 0),
  );

  for (const request of requests) {
    const template = domain.templateById.get(request.templateId) ?? null;
    const candidates = domain.tasks
      .filter((task) => task.templateId === request.templateId && !claimedTasks.has(task.id))
      .sort(
        (first, second) =>
          daysBetweenDates(first.dueDate, request.dueAt) - daysBetweenDates(second.dueDate, request.dueAt),
      );
    const best = candidates[0] ?? null;
    const distance = best ? daysBetweenDates(best.dueDate, request.dueAt) : null;
    const linked = best && distance !== null && distance <= ORDER_LINK_MAX_DAYS ? best : null;
    if (linked) claimedTasks.add(linked.id);

    const sample = linked ? resolveSample(linked.id, config) : resolveSample(request.id, config);
    specs.push({
      id: request.id,
      orderId: request.orderId,
      templateId: request.templateId,
      templateName: template?.name ?? request.name,
      methodCode: template?.methodCode ?? null,
      testStandard: template?.name ?? null,
      name: request.name,
      priority: request.priority,
      requestedAt: request.requestedAt?.toISOString() ?? null,
      dueAt: request.dueAt?.toISOString() ?? null,
      dueLabel: request.dueAt ? formatDateTime(request.dueAt) : null,
      sampleCount: request.sampleCount,
      sample,
      summary: request.summary,
      ruleStatus: request.ruleStatus,
      linkedTaskId: linked?.id ?? null,
      linkedTaskName: linked?.name ?? null,
      linkConfidence: linked ? (distance !== null && distance <= 7 ? 'medium' : 'low') : 'none',
      linkBasis: linked
        ? `同模板 ${request.templateId} + 交期相差 ${round1(distance)} 天（原型推断，需 TL 确认）`
        : '未找到同模板且交期接近的任务，需要先拆解任务',
    });
  }

  const byOrder = new Map();
  for (const spec of specs) {
    if (!byOrder.has(spec.orderId)) {
      byOrder.set(spec.orderId, {
        id: spec.orderId,
        source: 'LIS Test Order（模拟）',
        specs: [],
        priority: spec.priority,
        dueAt: spec.dueAt,
        sampleCount: 0,
      });
    }
    const order = byOrder.get(spec.orderId);
    order.specs.push(spec);
    order.sampleCount += spec.sampleCount ?? 0;
    if (!order.dueAt || (spec.dueAt && spec.dueAt < order.dueAt)) order.dueAt = spec.dueAt;
    if (priorityRank(spec.priority) < priorityRank(order.priority)) order.priority = spec.priority;
  }

  const orders = [...byOrder.values()]
    .map((order) => {
      const linkedSpecs = order.specs.filter((spec) => spec.linkedTaskId);
      const reviewSpecs = order.specs.filter((spec) => spec.ruleStatus === 'NeedsReview');
      const sampleState = linkedSpecs[0]?.sample ?? order.specs[0]?.sample ?? null;
      const status = reviewSpecs.length > 0 ? 'needs_review' : linkedSpecs.length > 0 ? 'ready_to_plan' : 'needs_task';
      return {
        ...order,
        dueLabel: order.dueAt ? formatDateTime(order.dueAt) : null,
        linkedTaskIds: linkedSpecs.map((spec) => spec.linkedTaskId),
        sample: sampleState,
        status,
        statusLabel:
          status === 'needs_review' ? '需方法审核' : status === 'needs_task' ? '待拆解任务' : '可排程',
        linkNote: '订单 → 任务的关联为原型推断，需与 LIMS 集成后由 TL 确认。',
      };
    })
    .sort((first, second) => priorityRank(first.priority) - priorityRank(second.priority) || (first.dueAt ?? '').localeCompare(second.dueAt ?? ''));

  return orders;
}

/** Compact order payload for the orders page and the chat card. */
export function orderSummary(order, domain) {
  const tasks = (order.linkedTaskIds ?? []).map((id) => domain.taskById.get(id)).filter(Boolean);
  return {
    id: order.id,
    source: order.source,
    priority: order.priority,
    dueAt: order.dueAt,
    dueLabel: order.dueLabel,
    daysLeft: order.daysLeft,
    sampleCount: order.sampleCount,
    status: order.status,
    statusLabel: order.statusLabel,
    sample: order.sample,
    specs: order.specs.map((spec) => ({
      id: spec.id,
      name: spec.name,
      templateId: spec.templateId,
      templateName: spec.templateName,
      methodCode: spec.methodCode,
      sampleCount: spec.sampleCount,
      priority: spec.priority,
      dueLabel: spec.dueLabel,
      ruleStatus: spec.ruleStatus,
      linkedTaskId: spec.linkedTaskId,
      linkedTaskName: spec.linkedTaskName,
      linkConfidence: spec.linkConfidence,
      linkBasis: spec.linkBasis,
      sample: spec.sample,
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      name: task.name,
      projectId: task.projectId,
      projectName: task.projectName,
      priority: task.priority,
      dueLabel: task.dueDate ? formatDateTime(task.dueDate) : null,
      effortHours: task.effortHours,
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
    samplePolicy: config.samplePolicy,
    taskTypeRules: config.taskTypeRules,
    taskTypeAssignments: Object.entries(config.taskTypes).map(([taskId, entry]) => ({
      taskId,
      type: entry.type,
      reason: entry.reason,
      confirmed: entry.confirmed === true,
    })),
  };
}
