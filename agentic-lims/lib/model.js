/**
 * Domain normalization for the customer-shaped dataset.
 *
 * The customer's LIMS is SPEC-centric: `SPEC → Activity`, wrapped by a PLAN
 * batch number. This module keeps that shape as the primary model and then
 * projects every *schedulable* activity onto the flat `task` contract that the
 * deterministic engine already consumes.
 *
 * Rules that matter here (all configurable, none hard-coded as "facts"):
 *   - only specs in an approved status with a plan window become tasks
 *     (HC-101 / HC-102);
 *   - effort comes from the standard activity first, then history, then the
 *     activity's own collated value (customer `Workload` is 0 everywhere);
 *   - competency checks are only hard when the spec says `competency_check=ON`;
 *   - sample readiness is read from the spec's `instock_date`, never invented.
 */
import {
  addDays,
  dateKey,
  diffHours,
  formatDate,
  parseInstant,
  priorityRank,
  round1,
  splitList,
  startOfDay,
  sum,
  timeToMin,
  toNumber,
} from './util.js';
import { applyUpgrade, normalizeUpgradeConfig } from './upgrade.js';

const DAY_MINUTES = 24 * 60;

/* ------------------------------------------------------------------ helpers */

function slugProject(name) {
  const text = String(name ?? '').trim();
  if (!text) return 'PRJ-UNASSIGNED';
  if (text.startsWith('[')) return `PRJ-${text.slice(1, 4).replace(/\D/g, '') || '0'}-OPS`;
  const ascii = text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 18);
  return `PRJ-${ascii || 'UNASSIGNED'}`;
}

function calendarFor(config, mode) {
  const table = config?.calendarPolicy ?? {};
  return table[mode] ?? table.workday ?? { start: '08:00', end: '18:00', allowWeekend: false };
}

/** Customer status strings are kept verbatim; unknown values never pass as schedulable. */
function statusMeta(config, rawStatus) {
  const code = String(rawStatus ?? '').trim();
  const states = config?.statusMachine?.states ?? [];
  const found = states.find((state) => state.code === code);
  if (found) return { ...found, known: true };
  return {
    code: code || 'Unknown',
    label: code ? `未知状态：${code}` : '状态缺失',
    phase: 'unknown',
    schedulable: false,
    requiresWindow: false,
    known: false,
  };
}

/** Priority: the customer fills it in the planning grid, not in the LIMS export. */
function resolvePriority(config, rawValue) {
  const scale = config?.priorityScale ?? { order: ['P1', 'P2', 'P3', 'P4'], map: { P1: 'Urgent', P2: 'High', P3: 'Normal', P4: 'Low' }, aliases: {}, unknownFallback: 'Normal' };
  const text = String(rawValue ?? '').trim();
  if (!text) {
    return { code: null, value: scale.unknownFallback ?? 'Normal', source: 'unset', warning: '优先级未填写，已按 Normal 处理' };
  }
  let code = null;
  if (scale.order?.includes(text)) code = text;
  else if (scale.aliases?.[text]) code = scale.aliases[text];
  if (!code) {
    const mappedValue = scale.order?.find((key) => scale.map?.[key] === text) ?? null;
    code = mappedValue;
  }
  if (!code) {
    return { code: null, value: scale.unknownFallback ?? 'Normal', source: 'unknown', warning: `未知优先级「${text}」，已按 ${scale.unknownFallback ?? 'Normal'} 处理` };
  }
  return {
    code,
    value: scale.map?.[code] ?? 'Normal',
    source: code === text ? 'planner-grid' : 'alias',
    warning: code === text ? null : `优先级「${text}」按别名映射为 ${code}`,
  };
}

/* ------------------------------------------------------------ normalizers */

function normalizeCompetency(row) {
  return {
    id: row.competency_id,
    externalId: row.external_id,
    type: row.competency_type,
    domain: row.domain,
    subDomain: row.sub_domain,
    subDomain2: row.sub_domain2,
    description: row.description,
  };
}

function normalizePerson(row) {
  const competencyIds = splitList(row.competency_ids);
  return {
    id: row.person_id,
    name: row.person_name,
    employmentType: row.employment_type,
    team: row.team,
    site: row.site || null,
    competencyIds,
    // Kept for the legacy payloads/UI that still read `qualifications`.
    qualifications: competencyIds,
    dailyCapacityHours: toNumber(row.daily_capacity_hours, 8),
    workStart: timeToMin(row.workday_start, 8 * 60),
    workEnd: timeToMin(row.workday_end, 17 * 60),
    weekendAllowed: String(row.weekend_allowed ?? '0') === '1',
    status: row.status,
  };
}

function normalizeResource(row, config) {
  const calendar = calendarFor(config, row.calendar_mode || 'workday');
  const kind = row.resource_kind === 'space' ? 'space' : row.resource_kind === 'subcontract' ? 'subcontract' : 'equipment';
  return {
    id: row.resource_id,
    name: row.resource_name,
    type: row.equipment_type,
    kind,
    site: row.site || null,
    location: row.location,
    capabilities: splitList(row.capabilities, '/'),
    status: row.status,
    calibrationDue: row.calibration_due || null,
    calendarMode: row.calendar_mode || 'workday',
    availableFrom: timeToMin(row.available_from, timeToMin(calendar.start, 8 * 60)),
    availableTo: timeToMin(row.available_to, timeToMin(calendar.end, 18 * 60)),
    allowsWeekend: kind === 'space' ? false : row.calendar_mode === '24h' ? calendar.allowWeekend !== false : Boolean(calendar.allowWeekend),
    maxConcurrentTasks: toNumber(row.max_concurrent_tasks, 1),
    leadTimeDays: row.lead_time_days ? toNumber(row.lead_time_days) : null,
    externalLabel: row.external_label || null,
    loadUnit: kind === 'subcontract' ? 'day' : 'hour',
  };
}

/** A standard aggregates its ordered activity steps (customer: activity rows in the gantt). */
function normalizeStandards(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.standard_id)) grouped.set(row.standard_id, []);
    grouped.get(row.standard_id).push(row);
  }
  const templates = [];
  const stepByKey = new Map();
  for (const [standardId, steps] of grouped) {
    steps.sort((first, second) => toNumber(first.activity_no) - toNumber(second.activity_no));
    const head = steps[0];
    const normalizedSteps = steps.map((row) => {
      const step = {
        standardId,
        standardCode: row.standard_code,
        standardTitle: row.standard_title,
        activityNo: toNumber(row.activity_no, 1),
        name: row.activity_name,
        equipmentType: row.equipment_type,
        competencyId: row.competency_id || null,
        prepMinutes: toNumber(row.prep_minutes),
        testMinutes: toNumber(row.test_minutes),
        durationLabel: row.duration_label,
        site: row.site,
        note: row.note,
      };
      stepByKey.set(`${standardId}#${step.activityNo}`, step);
      return step;
    });
    templates.push({
      id: standardId,
      standardId,
      name: head.standard_title,
      methodCode: head.standard_code,
      standardCode: head.standard_code,
      requiredEquipmentType: head.equipment_type,
      requiredQualification: normalizedSteps.map((step) => step.competencyId).filter(Boolean),
      requiredSpaceId: null,
      prepMinutes: normalizedSteps.reduce((total, step) => total + step.prepMinutes, 0),
      testMinutes: normalizedSteps.reduce((total, step) => total + step.testMinutes, 0),
      steps: normalizedSteps,
      notes: normalizedSteps.map((step) => step.note).filter(Boolean).join(' / '),
    });
  }
  return { templates, stepByKey };
}

function durationDays(activity, config) {
  const dayHours = toNumber(config?.durationPolicy?.dayEquivalentHours, 8);
  const value = toNumber(activity.duration_value, 0);
  if (!value) return null;
  if (activity.duration_unit === 'd') return value;
  if (activity.duration_unit === 'h') return round1(value / dayHours);
  return null;
}

function parseTesters(value, personByName) {
  return splitList(value).map((name) => {
    const person = personByName.get(name) ?? null;
    return {
      name,
      personId: person?.id ?? null,
      placeholder: !person,
      reason: person ? null : '客户数据里的 Testers 可能是角色占位符（如 TST BY SLT10），不是真实人员',
    };
  });
}

/* --------------------------------------------------------------- buildDomain */

/**
 * @param {object} raw - rows loaded from the bundled CSVs
 * @param {object|Map} [templateOverrides] - standardId by task/activity id
 * @param {{config?: object, taskOverrides?: object}} [options]
 */
export function buildDomain(raw, templateOverrides = {}, options = {}) {
  const config = normalizeUpgradeConfig(options.config ?? null);
  const now = parseInstant(options.now ?? undefined);

  const competencies = (raw.competencies ?? []).map(normalizeCompetency);
  const competencyById = new Map(competencies.map((item) => [item.id, item]));

  const persons = (raw.persons ?? []).map(normalizePerson);
  const personById = new Map(persons.map((item) => [item.id, item]));
  const personByName = new Map(persons.map((item) => [item.name, item]));

  const resources = (raw.equipment ?? []).map((row) => normalizeResource(row, config));
  const spaces = resources.filter((resource) => resource.kind === 'space');
  // Subcontract laboratories are scheduled like equipment but keep their own kind.
  const equipment = resources.filter((resource) => resource.kind !== 'space');
  const resourceById = new Map(resources.map((item) => [item.id, item]));
  const equipmentById = new Map(equipment.map((item) => [item.id, item]));
  const spaceById = new Map(spaces.map((item) => [item.id, item]));

  const { templates, stepByKey } = normalizeStandards(raw.standards ?? []);
  const standardRowsByStandard = new Map(
    templates.map((template) => [template.id, template.steps]),
  );
  const templateById = new Map(templates.map((item) => [item.id, item]));
  const templateOverrideById = new Map(templateById);

  /* specs ---------------------------------------------------------------- */
  const specs = (raw.specs ?? []).map((row) => {
    const status = statusMeta(config, row.status);
    const priority = resolvePriority(config, row.priority);
    const competencyCheck = String(row.competency_check ?? 'ON').trim().toUpperCase() === 'OFF' ? 'OFF' : 'ON';
    const windowStart = row.est_start_date ? parseInstant(row.est_start_date) : null;
    const windowEnd = row.est_end_date ? parseInstant(row.est_end_date) : null;
    return {
      id: row.spec_id,
      version: toNumber(row.spec_version, 1),
      objectId: row.object_id || row.spec_id,
      objectVersion: toNumber(row.object_version, 1),
      orderNo: row.order_no || null,
      project: row.project || null,
      projectId: slugProject(row.project),
      originOfNeed: row.origin_of_need || null,
      title: row.title || null,
      status: status.code,
      statusRaw: row.status,
      statusLabel: status.label,
      statusKnown: status.known,
      phase: status.phase,
      schedulable: Boolean(status.schedulable),
      requiresWindow: status.requiresWindow !== false,
      defaultReservation: status.reservation ?? null,
      team: row.team || null,
      createdBy: row.created_by || null,
      approver: row.approver || null,
      testers: parseTesters(row.testers, personByName),
      standards: splitList(row.standards),
      competencyIds: splitList(row.competency_ids),
      competencyCheck,
      windowStart,
      windowEnd,
      instockDate: row.instock_date ? parseInstant(row.instock_date) : null,
      sampleCount: toNumber(row.sample_count),
      workloadHours: toNumber(row.workload_hours),
      priority,
      planNo: row.plan_no || null,
      parentSpecId: row.parent_spec_id || null,
      costCode: row.cost_code || null,
      createdAt: row.created_at ? parseInstant(row.created_at) : null,
      note: row.note || null,
      activityIds: [],
      site: null,
    };
  });
  const specById = new Map(specs.map((item) => [item.id, item]));

  /* activities ----------------------------------------------------------- */
  const specActivities = (raw.specActivities ?? []).map((row, index) => {
    const spec = specById.get(row.spec_id) ?? null;
    const resource = resourceById.get(row.resource_id) ?? null;
    // The standard step is matched by activity NAME first: the spec's own
    // activity_no is the sequence inside the spec, not the step index inside the
    // standard (e.g. spec activity 3 = standard step 6 "Laserbay test data").
    const standardSteps = row.standard_id ? standardRowsByStandard.get(row.standard_id) ?? null : null;
    const step = standardSteps
      ? standardSteps.find((entry) => entry.name === row.activity_name) ??
        stepByKey.get(`${row.standard_id}#${toNumber(row.activity_no, 1)}`) ??
        null
      : null;
    return {
      id: row.activity_id || `SA-${row.spec_id}-${index + 1}`,
      specId: row.spec_id,
      planNo: row.plan_no || spec?.planNo || null,
      activityNo: toNumber(row.activity_no, 1),
      name: row.activity_name,
      type: row.activity_type || 'spec_activity',
      resourceId: row.resource_id || null,
      resource,
      cubeId: row.cube_id || null,
      personId: row.person_id || null,
      person: row.person_id ? personById.get(row.person_id) ?? null : null,
      durationValue: toNumber(row.duration_value, 0),
      durationUnit: row.duration_unit || 'd',
      durationDays: durationDays(row, config),
      effortHours: row.effort_hours === '' ? null : toNumber(row.effort_hours),
      sequenceInWeek: row.sequence_in_week || null,
      start: row.start_datetime ? parseInstant(row.start_datetime) : null,
      end: row.end_datetime ? parseInstant(row.end_datetime) : null,
      status: row.status || null,
      note: row.note || null,
      standardId: row.standard_id || null,
      step,
      site: row.site || resource?.site || null,
    };
  });
  for (const activity of specActivities) {
    const spec = specById.get(activity.specId);
    if (!spec) continue;
    spec.activityIds.push(activity.id);
    if (!spec.site && activity.site) spec.site = activity.site;
  }

  /* plans ---------------------------------------------------------------- */
  const plans = (raw.plans ?? []).map((row) => ({
    planNo: row.plan_no,
    project: row.project || null,
    site: row.site || null,
    status: row.plan_status || null,
    createdBy: row.created_by || null,
    windowStart: row.window_start ? parseInstant(row.window_start) : null,
    windowEnd: row.window_end ? parseInstant(row.window_end) : null,
    specIds: splitList(row.spec_ids),
    note: row.note || null,
  }));
  const planByNo = new Map(plans.map((item) => [item.planNo, item]));

  /* sample readiness from the spec's real Instockdate ------------------- */
  function sampleForSpec(spec) {
    if (!spec) {
      return { status: 'Unknown', statusLabel: '样品状态待确认', tone: 'idle', readyAt: null, inStock: false, blocked: false, confirmed: false, source: 'missing', note: '没有关联 spec，无法判断样品' };
    }
    if (!spec.instockDate) {
      return {
        status: 'Unknown',
        statusLabel: '样品状态待确认',
        tone: 'idle',
        required: spec.sampleCount || null,
        readyAt: null,
        inStock: false,
        blocked: false,
        confirmed: false,
        source: 'missing',
        note: 'SPEC 导出里没有 Instockdate，需要 TL 补充后才能判断。',
      };
    }
    const dayKey = dateKey(spec.instockDate);
    const todayKey = dateKey(now);
    const inStock = dayKey <= todayKey;
    return {
      status: inStock ? 'In stock' : 'Not in stock',
      statusLabel: inStock ? '样品已到位' : '样品未到位',
      tone: inStock ? 'ok' : 'warn',
      required: spec.sampleCount || null,
      available: inStock ? spec.sampleCount || null : 0,
      readyAt: spec.instockDate.toISOString(),
      expectedInStockAt: spec.instockDate.toISOString(),
      actualInStockAt: inStock ? spec.instockDate.toISOString() : null,
      inStock,
      partial: false,
      blocked: false,
      confirmed: false,
      source: 'spec-export',
      note: inStock ? '来自 SPEC 导出的 Instockdate（日期粒度）' : `预计 ${dayKey} 到样，之前不得开始实际测试`,
    };
  }

  /* tasks: schedulable activities only ---------------------------------- */
  const tasks = [];
  for (const activity of specActivities) {
    const spec = specById.get(activity.specId);
    if (!spec) continue;
    if (activity.type === 'test_execution') continue; // execution record, not a booking
    if (!spec.schedulable) continue; // HC-101
    if (!spec.windowEnd) continue; // HC-102
    if (!activity.resource) continue; // nothing to book

    const overrideId = templateOverrides instanceof Map ? templateOverrides.get(activity.id) : templateOverrides?.[activity.id];
    const templateId = overrideId && templateOverrideById.has(overrideId) ? overrideId : activity.standardId;
    const template = templateById.get(templateId) ?? null;
    const step = activity.step ?? template?.steps?.find((entry) => entry.activityNo === activity.activityNo) ?? null;

    const standardEffort = step?.testMinutes ? round1((step.testMinutes + (step.prepMinutes ?? 0)) / 60) : null;
    const effortHours = activity.effortHours ?? standardEffort ?? null;
    const effortSource = activity.effortHours
      ? 'activity'
      : standardEffort
        ? 'standard'
        : 'missing';

    const requiredCompetencies =
      spec.competencyCheck === 'OFF' ? [] : step?.competencyId ? [step.competencyId] : spec.competencyIds;
    const spaceIds = activity.cubeId && spaceById.has(activity.cubeId) ? [activity.cubeId] : [];
    const reservationMode = overrideReservation(config, activity.id, spec, activity);

    tasks.push({
      id: activity.id,
      specId: spec.id,
      spec,
      specStatus: spec.status,
      specStatusLabel: spec.statusLabel,
      planNo: activity.planNo,
      activityNo: activity.activityNo,
      activityType: activity.type,
      site: activity.site,
      projectId: spec.projectId,
      projectName: spec.project ?? '（未归属项目）',
      projectCode: spec.costCode,
      testNo: spec.id,
      name: activity.name,
      method: step ? `${step.standardCode} · ${step.name}` : spec.standards.join(' / '),
      priority: spec.priority.value,
      priorityCode: spec.priority.code,
      prioritySource: spec.priority.source,
      requestedStart: spec.windowStart,
      dueDate: spec.windowEnd,
      effortHours: effortHours ?? 0,
      effortSource,
      elapsedDays: activity.durationDays ?? null,
      durationLabel: `${activity.durationValue}${activity.durationUnit}`,
      status: activity.status || spec.status,
      sample: sampleForSpec(spec),
      competencyCheck: spec.competencyCheck,
      reservationMode,
      template,
      templateId: template?.id ?? null,
      templateOverrideId: null,
      requirements: {
        equipmentIds: [activity.resource.id],
        equipmentType: activity.resource.type,
        spaceIds,
        competencyIds: requiredCompetencies,
        qualifications: requiredCompetencies,
        qualificationLabels: requiredCompetencies.map((id) => competencyById.get(id)?.externalId ?? id),
        prepMinutes: step?.prepMinutes ?? 0,
        estimatedTestMinutes: step?.testMinutes ?? 0,
      },
      plannedPersonId: activity.personId,
      plannedStart: activity.start,
      plannedEnd: activity.end,
      activity,
    });
  }
  const taskById = new Map(tasks.map((item) => [item.id, item]));

  /* orders: the planner grid carries Order + LIMS No. per line ---------- */
  const standardIdByCode = new Map(templates.map((template) => [template.methodCode, template.id]));
  const requests = specs
    .filter((spec) => spec.phase === 'request')
    .map((spec) => ({
      id: spec.id,
      specId: spec.id,
      orderId: spec.orderNo,
      templateId: spec.standards.length ? standardIdByCode.get(spec.standards[0]) ?? null : null,
      name: spec.title ?? spec.id,
      priority: spec.priority.value,
      requestedAt: spec.createdAt,
      dueAt: spec.windowEnd,
      sampleCount: spec.sampleCount,
      summary: [spec.originOfNeed, spec.standards.join(' / ')].filter(Boolean).join(' · '),
      ruleStatus: spec.status === 'In approval' ? 'NeedsReview' : 'New',
    }));

  const activities = (raw.activities ?? []).map((row) => ({
    id: row.activity_id,
    personId: row.person_id,
    type: row.activity_type,
    title: row.title,
    start: parseInstant(row.start_datetime),
    end: parseInstant(row.end_datetime),
    impact: row.availability_impact,
    blockedHours: toNumber(row.blocked_hours),
    notes: row.notes,
  }));

  const allocations = (raw.allocations ?? []).map((row) => ({
    id: row.allocation_id,
    taskId: row.task_id,
    personId: row.person_id || null,
    resourceId: row.resource_id || null,
    date: row.allocation_date,
    type: row.allocation_type,
    load: toNumber(row.planned_load),
    unit: row.load_unit,
    notes: row.notes,
  }));

  const history = (raw.history ?? []).map((row) => ({
    id: row.history_id,
    templateId: row.template_id,
    methodCode: row.method_code,
    equipmentId: row.equipment_id || null,
    spaceId: row.space_id || null,
    personId: row.tester_id || null,
    plannedStart: parseInstant(row.planned_start),
    plannedEnd: parseInstant(row.planned_end),
    plannedMinutes: toNumber(row.planned_duration_min),
    actualMinutes: toNumber(row.actual_duration_min),
    finalStatus: row.final_status,
    priority: row.priority,
    note: row.deviation_note,
  }));

  const constraints = (raw.constraints ?? []).map((row) => ({
    id: row.constraint_id,
    type: row.constraint_type,
    name: row.name,
    rule: row.rule,
    handling: row.handling,
    source: row.source || null,
    confirmed: String(row.confirmed ?? 'false') === 'true',
  }));

  const assignments = (raw.assignments ?? []).map((row) => ({
    id: row.assignment_id,
    taskId: row.task_id,
    resourceId: row.resource_id,
    role: row.resource_role,
    status: row.assignment_status,
  }));

  /* projects: derived from the spec header, not from tasks --------------- */
  const projectMap = new Map();
  for (const spec of specs) {
    const id = spec.projectId;
    if (!projectMap.has(id)) {
      projectMap.set(id, {
        id,
        name: spec.project ?? '（未归属项目）',
        code: spec.costCode,
        priority: spec.priority.value,
        specIds: [],
        taskIds: [],
      });
    }
    const project = projectMap.get(id);
    project.specIds.push(spec.id);
    if (priorityRank(spec.priority.value) < priorityRank(project.priority)) project.priority = spec.priority.value;
  }
  for (const task of tasks) {
    const project = projectMap.get(task.projectId);
    if (project) project.taskIds.push(task.id);
  }
  const projects = [...projectMap.values()];

  const domain = {
    config,
    now,
    competencies,
    competencyById,
    persons,
    personById,
    resources,
    resourceById,
    equipment,
    equipmentById,
    spaces,
    spaceById,
    templates,
    templateById,
    specs,
    specById,
    specActivities,
    plans,
    planByNo,
    tasks,
    taskById,
    personActivities: activities,
    allocations,
    history,
    constraints,
    requests,
    assignments,
    projects,
    sampleForSpec,
    raw,
  };
  return applyUpgrade(domain, config);
}

/** Reservation mode: status default → activity override → task type rules. */
function overrideReservation(config, activityId, spec, activity) {
  const explicit = config?.reservationOverrides?.[activityId];
  if (explicit?.mode) return explicit.mode;
  if (spec.defaultReservation) return spec.defaultReservation;
  if (activity.type === 'subcontracted') return 'Subcontracted';
  return config?.defaultReservationMode ?? 'Shared';
}

/* ------------------------------------------------------------- matching */

export function competencyLabels(domain, ids) {
  return (ids ?? []).map((id) => domain.competencyById.get(id)?.externalId ?? id);
}

export function personMatches(person, competencyIds, competencyById = null) {
  const required = competencyIds ?? [];
  const missingIds = required.filter((id) => !person.competencyIds.includes(id));
  const matchedIds = required.filter((id) => person.competencyIds.includes(id));
  const label = (id) => competencyById?.get?.(id)?.externalId ?? id;
  return {
    matched: matchedIds,
    missing: missingIds.map(label),
    missingIds,
    missingLabels: missingIds.map(label),
    qualified: required.length === 0 ? true : missingIds.length === 0,
    any: matchedIds.length > 0,
  };
}

export function equipmentCandidatesForTask(domain, task) {
  const explicit = (task.requirements?.equipmentIds ?? [])
    .map((id) => domain.equipmentById.get(id))
    .filter(Boolean);
  if (explicit.length > 0) {
    return {
      required: explicit,
      alternatives: domain.equipment.filter(
        (item) => !explicit.some((entry) => entry.id === item.id) && item.type === explicit[0].type && item.site === explicit[0].site,
      ),
    };
  }
  const type = task.requirements?.equipmentType;
  const site = task.site;
  const matches = domain.equipment.filter(
    (item) => (!type || item.type === type) && (!site || item.site === site || item.kind === 'subcontract'),
  );
  return { required: matches, alternatives: [] };
}

export function spaceCandidatesForTask(domain, task) {
  const explicit = (task.requirements?.spaceIds ?? []).map((id) => domain.spaceById.get(id)).filter(Boolean);
  if (explicit.length > 0) return explicit;
  return [];
}

export function personCandidatesForTask(domain, task) {
  const results = [];
  for (const person of domain.persons) {
    if (person.status !== 'Active') continue;
    // HC-110: a site's people do not staff another site.
    if (task.site && person.site && task.site !== 'EXTERNAL' && person.site !== task.site) continue;
    const match = personMatches(person, task.requirements.competencyIds, domain.competencyById);
    if (match.qualified || (isReviewTask(task) && match.any)) {
      results.push({ person, ...match });
    }
  }
  return results;
}

export function isReviewTask(task) {
  return /review/i.test(String(task.status ?? '')) || task.status === 'Needs Method Review';
}

/* ------------------------------------------------------------- readiness */

export function taskReadiness(domain, task) {
  const spec = task.spec ?? domain.specById.get(task.specId) ?? null;
  if (spec && !spec.schedulable) {
    return { state: 'not_schedulable', label: `状态「${spec.statusLabel}」不可排`, tone: 'idle', reason: 'HC-101' };
  }
  if (!task.dueDate) {
    return { state: 'no_window', label: '缺计划窗口', tone: 'error', reason: 'HC-102' };
  }
  if (spec && spec.competencyCheck === 'ON' && task.requirements.competencyIds.length > 0) {
    const persons = personCandidatesForTask(domain, task);
    if (persons.length === 0) {
      return { state: 'blocked', label: '无合格人员', tone: 'error', reason: 'HC-104' };
    }
  }
  const candidates = equipmentCandidatesForTask(domain, task).required;
  const today = dateKey(domain.now ?? task.dueDate ?? new Date());
  const calibrationExpired = (item) => Boolean(item.calibrationDue) && item.calibrationDue < today;
  const equipment = candidates.filter((item) => item.status === 'Operational' && !calibrationExpired(item));
  if (equipment.length === 0) {
    const offline = candidates.map((item) =>
      calibrationExpired(item) ? `${item.name}（校准 ${item.calibrationDue} 已到期）` : `${item.name}（${item.status}）`,
    );
    return {
      state: 'blocked',
      label: offline.length ? `设备不可用：${offline.join('、')}` : '无可用设备',
      tone: 'error',
      reason: 'HC-105',
    };
  }
  if (task.sample?.status === 'Unknown') {
    return { state: 'sample_unknown', label: '样品状态待确认', tone: 'warn', reason: 'HC-108' };
  }
  if (isReviewTask(task)) {
    return { state: 'needs_review', label: '需方法审核', tone: 'warn', reason: 'HC-101' };
  }
  if (spec && ['Pre-booked', 'Finalized'].includes(spec.status)) {
    return { state: 'booked', label: spec.status === 'Pre-booked' ? '已预占' : '计划已定稿', tone: 'brand', reason: 'SC-106' };
  }
  return { state: 'ready', label: '可排程', tone: 'ok' };
}

export function taskRisk(domain, task, now) {
  const readiness = taskReadiness(domain, task);
  if (readiness.state === 'blocked') {
    return { level: 'high', label: '阻塞', detail: readiness.label, daysLeft: 0 };
  }
  if (readiness.state === 'no_window' || readiness.state === 'not_schedulable') {
    return { level: 'medium', label: '不可排', detail: readiness.label, daysLeft: null };
  }
  const dueDate = task.dueDate ?? now;
  const daysLeft = Math.max(0, Math.ceil(diffHours(dueDate, now) / 24));
  const usableDays = Math.max(1, daysLeft + 1);
  const nominalCapacity = usableDays * 6;
  if (readiness.state === 'sample_unknown') {
    return { level: 'medium', label: '样品待确认', detail: 'Instockdate 缺失，必须由 TL 补充', daysLeft };
  }
  if (task.effortHours > nominalCapacity) {
    return {
      level: 'high',
      label: '高延期风险',
      detail: `剩余 ${daysLeft} 天，约 ${round1(nominalCapacity)}h 可用，任务需 ${task.effortHours}h`,
      daysLeft,
    };
  }
  if (task.effortHours > nominalCapacity * 0.65) {
    return {
      level: 'medium',
      label: '交期偏紧',
      detail: `工作量占可用窗口约 ${Math.round((task.effortHours / nominalCapacity) * 100)}%`,
      daysLeft,
    };
  }
  if (readiness.state === 'needs_review') {
    return { level: 'medium', label: '待审核', detail: '非标准方法需人工确认资源和资质', daysLeft };
  }
  return { level: 'low', label: '正常', detail: `交期前约 ${daysLeft} 天可用`, daysLeft };
}

export function taskSummary(domain, task, now, extra = {}) {
  const readiness = taskReadiness(domain, task);
  const risk = taskRisk(domain, task, now);
  const equipment = equipmentCandidatesForTask(domain, task);
  const persons = personCandidatesForTask(domain, task);
  const allocations = domain.allocations.filter((item) => item.taskId === task.id);
  const spec = task.spec ?? domain.specById.get(task.specId) ?? null;
  return {
    id: task.id,
    specId: task.specId,
    specStatus: task.specStatus,
    specStatusLabel: task.specStatusLabel,
    planNo: task.planNo,
    site: task.site,
    activityNo: task.activityNo,
    activityType: task.activityType,
    name: task.name,
    method: task.method,
    projectId: task.projectId,
    projectName: task.projectName,
    projectCode: task.projectCode,
    testNo: task.testNo,
    priority: task.priority,
    priorityCode: task.priorityCode,
    prioritySource: task.prioritySource,
    status: task.status,
    readiness,
    risk,
    requestedStart: task.requestedStart?.toISOString() ?? null,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    dueLabel: task.dueDate ? formatDate(task.dueDate, true) : '—',
    effortHours: task.effortHours,
    effortSource: task.effortSource,
    elapsedDays: task.elapsedDays,
    durationLabel: task.durationLabel,
    competencyIds: task.requirements.competencyIds,
    competencyLabels: competencyLabels(domain, task.requirements.competencyIds),
    competencyCheck: task.competencyCheck,
    qualifications: task.requirements.competencyIds,
    equipmentIds: task.requirements.equipmentIds,
    equipmentType: task.requirements.equipmentType,
    spaceIds: task.requirements.spaceIds,
    templateId: task.templateId,
    templateName: task.template?.name ?? null,
    standardCode: task.template?.methodCode ?? null,
    reservationMode: task.reservationMode,
    reservationModeLabel: domain.config?.reservationModes?.[task.reservationMode]?.label ?? task.reservationMode,
    taskType: task.reservationMode,
    taskTypeLabel: domain.config?.reservationModes?.[task.reservationMode]?.label ?? task.reservationMode,
    taskTypeReason: domain.config?.reservationOverrides?.[task.id]?.reason ?? null,
    taskTypeConfirmed: domain.config?.reservationOverrides?.[task.id]?.confirmed === true,
    sample: task.sample ?? null,
    sampleReadyAt: task.sample?.readyAt ?? null,
    sampleSource: task.sample?.source ?? null,
    orderIds: spec?.orderNo ? [spec.orderNo] : [],
    specIds: spec ? [spec.id] : [],
    overriddenFields: task.overriddenFields ?? [],
    candidateEquipment: equipment.required.map((item) => ({ id: item.id, name: item.name, status: item.status, site: item.site, kind: item.kind })),
    candidatePersons: persons.map((entry) => ({
      id: entry.person.id,
      name: entry.person.name,
      site: entry.person.site,
      missing: entry.missingIds.map((id) => domain.competencyById.get(id)?.description ?? id),
    })),
    allocatedHours: round1(sum(allocations.map((item) => item.load))),
    ...extra,
  };
}

/* ------------------------------------------------------------------ specs */

export function specLifecycle(domain, spec) {
  const missing = [];
  if (!spec.instockDate) missing.push('Instockdate（样品到位日期）');
  if (!spec.windowStart) missing.push('Estimated starting date');
  if (!spec.windowEnd) missing.push('Estimated end date');
  if (!spec.priority.code) missing.push('Priority（排程表填写，LIMS 导出里没有）');
  if (spec.competencyCheck === 'ON' && spec.competencyIds.length === 0) missing.push('Competency（能力校验开启但未填能力项）');
  const reasons = [];
  if (!spec.schedulable) reasons.push(`状态「${spec.statusLabel}」不在排程池（HC-101）`);
  if (spec.schedulable && !spec.windowEnd) reasons.push('缺计划窗口，不得排程（HC-102）');
  return {
    state: spec.schedulable && spec.windowEnd ? 'schedulable' : !spec.schedulable ? 'not_schedulable' : 'no_window',
    schedulable: Boolean(spec.schedulable && spec.windowEnd),
    statusLabel: spec.statusLabel,
    phase: spec.phase,
    reasons,
    missingFields: missing,
  };
}

export function specSummary(domain, spec, now) {
  const lifecycle = specLifecycle(domain, spec);
  const activities = spec.activityIds.map((id) => domain.specActivities.find((activity) => activity.id === id)).filter(Boolean);
  const tasks = activities.map((activity) => domain.taskById.get(activity.id)).filter(Boolean);
  return {
    id: spec.id,
    version: spec.version,
    objectId: spec.objectId,
    orderNo: spec.orderNo,
    project: spec.project,
    projectId: spec.projectId,
    site: spec.site,
    originOfNeed: spec.originOfNeed,
    title: spec.title,
    status: spec.status,
    statusLabel: spec.statusLabel,
    phase: spec.phase,
    lifecycle,
    team: spec.team,
    createdBy: spec.createdBy,
    approver: spec.approver,
    testers: spec.testers,
    standards: spec.standards,
    competencyIds: spec.competencyIds,
    competencyLabels: competencyLabels(domain, spec.competencyIds),
    competencyCheck: spec.competencyCheck,
    windowStart: spec.windowStart?.toISOString() ?? null,
    windowEnd: spec.windowEnd?.toISOString() ?? null,
    windowLabel:
      spec.windowStart && spec.windowEnd
        ? `${formatDate(spec.windowStart)}–${formatDate(spec.windowEnd)}`
        : null,
    instockDate: spec.instockDate ? dateKey(spec.instockDate) : null,
    sampleCount: spec.sampleCount,
    workloadHours: spec.workloadHours,
    priority: spec.priority,
    planNo: spec.planNo,
    costCode: spec.costCode,
    createdAt: spec.createdAt?.toISOString() ?? null,
    note: spec.note,
    sample: domain.sampleForSpec(spec),
    activities: activities.map((activity) => {
      const task = domain.taskById.get(activity.id) ?? null;
      return {
        id: activity.id,
        activityNo: activity.activityNo,
        name: activity.name,
        type: activity.type,
        site: activity.site,
        resourceId: activity.resourceId,
        resourceName: activity.resource?.name ?? null,
        cubeId: activity.cubeId,
        personId: activity.personId,
        durationLabel: `${activity.durationValue}${activity.durationUnit}`,
        effortHours: activity.effortHours,
        status: activity.status,
        planNo: activity.planNo,
        scheduled: Boolean(activity.start || task),
        readiness: task ? taskReadiness(domain, task) : null,
      };
    }),
    taskIds: tasks.map((task) => task.id),
    daysLeft: spec.windowEnd ? round1(diffHours(spec.windowEnd, now) / 24) : null,
  };
}

/* --------------------------------------------------------------- capacity */

export function equipmentStatusTone(status) {
  if (status === 'Operational' || status === 'Available') return 'ok';
  if (/calibration|maintenance/i.test(status)) return 'warn';
  return 'idle';
}

export function calendarLoads(domain, windowStart, windowDays) {
  const person = new Map();
  const resource = new Map();
  const startKey = dateKey(windowStart);
  const endKey = dateKey(addDays(startOfDay(windowStart), windowDays - 1));
  const inWindow = (day) => day >= startKey && day <= endKey;
  for (const allocation of domain.allocations) {
    if (!inWindow(allocation.date)) continue;
    if (allocation.type === 'Person effort' && allocation.personId) {
      const key = `${allocation.personId}|${allocation.date}`;
      person.set(key, round1((person.get(key) ?? 0) + allocation.load));
    } else if (allocation.resourceId) {
      const key = `${allocation.resourceId}|${allocation.date}`;
      resource.set(key, round1((resource.get(key) ?? 0) + allocation.load));
    }
  }
  const activity = new Map();
  for (const entry of domain.personActivities ?? []) {
    let cursor = startOfDay(entry.start);
    const last = startOfDay(entry.end);
    const days = Math.max(1, Math.round((last.getTime() - cursor.getTime()) / 86400000) + 1);
    const perDay = entry.blockedHours > 0 ? entry.blockedHours / days : 0;
    for (let index = 0; index < days; index += 1) {
      const key = `${entry.personId}|${dateKey(cursor)}`;
      activity.set(key, round1((activity.get(key) ?? 0) + perDay));
      cursor = addDays(cursor, 1);
    }
  }
  return { person, resource, activity, startKey, endKey };
}

export function resourceLoadSummary(domain, resourceId, windowStart, windowDays, loads) {
  const resource = domain.resourceById.get(resourceId) ?? domain.equipmentById.get(resourceId) ?? domain.spaceById.get(resourceId);
  if (!resource) return null;
  let used = 0;
  let peak = 0;
  let peakDay = null;
  const capacityPerDay = Math.max(0, (resource.availableTo - resource.availableFrom) / 60);
  for (let index = 0; index < windowDays; index += 1) {
    const day = dateKey(addDays(windowStart, index));
    const load = loads.resource.get(`${resourceId}|${day}`) ?? 0;
    used += load;
    if (load > peak) {
      peak = load;
      peakDay = day;
    }
  }
  return {
    id: resource.id,
    name: resource.name,
    type: resource.type,
    kind: resource.kind,
    site: resource.site,
    location: resource.location,
    status: resource.status,
    statusTone: equipmentStatusTone(resource.status),
    capabilities: resource.capabilities,
    calibrationDue: resource.calibrationDue,
    calendarMode: resource.calendarMode,
    workStart: resource.availableFrom,
    workEnd: resource.availableTo,
    capacityPerDay,
    usedHours: round1(used),
    capacityHours: round1(capacityPerDay * windowDays),
    utilizationPct: capacityPerDay * windowDays > 0 ? Math.round((used / (capacityPerDay * windowDays)) * 100) : 0,
    peakHours: round1(peak),
    peakDay,
  };
}

export function personLoadSummary(domain, person, windowStart, windowDays, loads) {
  let used = 0;
  let activityHours = 0;
  let peak = 0;
  const days = [];
  for (let index = 0; index < windowDays; index += 1) {
    const day = dateKey(addDays(windowStart, index));
    const taskLoad = loads.person.get(`${person.id}|${day}`) ?? 0;
    const blocked = loads.activity.get(`${person.id}|${day}`) ?? 0;
    used += taskLoad;
    activityHours += blocked;
    peak = Math.max(peak, taskLoad + blocked);
    days.push({ day, taskLoad: round1(taskLoad), blocked: round1(blocked), capacity: person.dailyCapacityHours });
  }
  return {
    id: person.id,
    name: person.name,
    employmentType: person.employmentType,
    team: person.team,
    site: person.site,
    competencyIds: person.competencyIds,
    qualifications: person.competencyIds,
    dailyCapacityHours: person.dailyCapacityHours,
    workStart: person.workStart,
    workEnd: person.workEnd,
    status: person.status,
    usedHours: round1(used),
    activityHours: round1(activityHours),
    utilizationPct: person.dailyCapacityHours * windowDays > 0 ? Math.round((used / (person.dailyCapacityHours * windowDays)) * 100) : 0,
    peakHours: round1(peak),
    days,
  };
}

export function prioritize(tasks) {
  return [...tasks].sort((first, second) => {
    const rank = priorityRank(first.priority) - priorityRank(second.priority);
    if (rank !== 0) return rank;
    const firstDue = first.dueDate ? first.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
    const secondDue = second.dueDate ? second.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
    if (firstDue !== secondDue) return firstDue - secondDue;
    return (first.activityNo ?? 0) - (second.activityNo ?? 0);
  });
}

export { DAY_MINUTES };
