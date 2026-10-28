/**
 * Normalize the bundled CSV rows into the prototype's domain objects.
 * Everything here is pure and reusable by the engine, the HTTP routes and the tools.
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
  unique,
} from './util.js';
import { applyUpgrade, normalizeUpgradeConfig } from './upgrade.js';

const EQUIPMENT_KEYWORDS = [
  { match: ['gc'], type: 'GC-FID' },
  { match: ['hplc'], type: 'HPLC' },
  { match: ['balance'], type: 'Precision Balance' },
  { match: ['stability', 'climate', 'thermal'], type: 'Climate Chamber' },
  { match: ['tensile', 'durability', 'endurance', 'mechanical', 'electrical'], type: 'Universal Tester' },
];

function inferEquipmentType(method) {
  const text = String(method ?? '').toLowerCase();
  for (const entry of EQUIPMENT_KEYWORDS) {
    if (entry.match.some((token) => text.includes(token))) return entry.type;
  }
  return null;
}

function matchTemplate(task, templates, equipmentById) {
  const method = String(task.test_method ?? '').toLowerCase();
  const explicitType = splitList(task.required_equipment_ids)
    .filter((id) => id.startsWith('EQ-'))
    .map((id) => equipmentById.get(id)?.type)
    .filter(Boolean)[0];
  const inferred = explicitType ?? inferEquipmentType(task.test_method);
  let best = null;
  let bestScore = 0;
  for (const template of templates) {
    let score = 0;
    const requiredType = String(template.requiredEquipmentType ?? '').toLowerCase();
    if (requiredType && inferred && (requiredType === inferred.toLowerCase() || requiredType.includes(inferred.toLowerCase()) || inferred.toLowerCase().includes(requiredType))) {
      score += 3;
    }
    const name = String(template.name ?? template.templateName ?? '').toLowerCase();
    const words = name.split(/[^a-z0-9]+/).filter((word) => word.length > 3);
    const matches = words.filter((word) => method.includes(word)).length;
    // One shared generic word ("validation", "standard") is too weak to pick a
    // template; require at least two distinctive words before adding name score.
    if (matches >= 2) score += matches;
    if (score > bestScore) {
      best = template;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function normalizePerson(row) {
  return {
    id: row.person_id,
    name: row.person_name,
    employmentType: row.employment_type,
    team: row.team,
    qualifications: splitList(row.qualifications),
    dailyCapacityHours: toNumber(row.daily_capacity_hours, 8),
    workStart: timeToMin(row.workday_start, 8 * 60),
    workEnd: timeToMin(row.workday_end, 17 * 60),
    status: row.status,
  };
}

function normalizeResource(row) {
  const isSpace = row.equipment_id.startsWith('SP-');
  return {
    id: row.equipment_id,
    name: row.equipment_name,
    type: row.equipment_type,
    kind: isSpace ? 'space' : 'equipment',
    location: row.location,
    capabilities: splitList(row.capabilities, '/'),
    status: row.status,
    calibrationDue: row.maintenance_or_calibration_due || null,
    availableFrom: timeToMin(row.available_from, 8 * 60),
    availableTo: timeToMin(row.available_to, 18 * 60),
  };
}

function normalizeActivity(row) {
  return {
    id: row.activity_id,
    personId: row.person_id,
    type: row.activity_type,
    title: row.title,
    start: parseInstant(row.start_datetime),
    end: parseInstant(row.end_datetime),
    impact: row.availability_impact,
    blockedHours: toNumber(row.blocked_hours),
    notes: row.notes,
  };
}

function normalizeAllocation(row) {
  return {
    id: row.allocation_id,
    taskId: row.task_id,
    personId: row.person_id || null,
    resourceId: row.resource_id || null,
    date: row.allocation_date,
    type: row.allocation_type,
    load: toNumber(row.planned_load),
    unit: row.load_unit,
    notes: row.notes,
  };
}

/**
 * @param {object} raw - CSV rows
 * @param {object|Map} [templateOverrides] - taskId → templateId override
 * @param {{config?: object, taskOverrides?: object}} [options] - upgrade config and
 *   change overrides (priority / due date) kept outside the raw CSV
 */
export function buildDomain(raw, templateOverrides = {}, options = {}) {
  const persons = raw.persons.map(normalizePerson);
  const resources = raw.equipment.map(normalizeResource);
  const equipment = resources.filter((resource) => resource.kind === 'equipment');
  const spaces = resources.filter((resource) => resource.kind === 'space');
  const equipmentById = new Map(equipment.map((item) => [item.id, item]));
  const spaceById = new Map(spaces.map((item) => [item.id, item]));
  const personById = new Map(persons.map((item) => [item.id, item]));

  const templates = raw.templates.map((row) => ({
    id: row.template_id,
    name: row.template_name,
    methodCode: row.method_code,
    requiredEquipmentType: row.required_equipment_type,
    requiredQualification: splitList(row.required_qualification),
    requiredSpaceId: row.required_space_id || null,
    prepMinutes: toNumber(row.prep_duration_min),
    testMinutes: toNumber(row.test_duration_min),
    notes: row.notes,
  }));
  const templateById = new Map(templates.map((item) => [item.id, item]));

  const tasks = raw.tasks.map((row) => {
    const allIds = splitList(row.required_equipment_ids);
    const explicitEquipmentIds = allIds.filter((id) => id.startsWith('EQ-'));
    const explicitSpaceIds = unique([
      ...splitList(row.required_space_ids),
      ...allIds.filter((id) => id.startsWith('SP-')),
    ]);
    const template = matchTemplate(row, templates, equipmentById);
    const inferredType = inferEquipmentType(row.test_method);
    const equipmentType =
      explicitEquipmentIds.map((id) => equipmentById.get(id)?.type).filter(Boolean)[0] ??
      (template?.requiredEquipmentType && equipmentById.size > 0
        ? equipment.find((item) => item.type.toLowerCase() === String(template.requiredEquipmentType).toLowerCase())?.type
        : null) ??
      inferredType;
    const qualifications = splitList(row.required_qualifications);
    return {
      id: row.task_id,
      projectId: row.project_id,
      projectName: row.project_name,
      projectCode: row.project_code,
      testNo: row.test_no,
      name: row.task_name,
      method: row.test_method,
      priority: row.priority || 'Normal',
      requestedStart: row.requested_start ? parseInstant(row.requested_start) : null,
      dueDate: parseInstant(row.due_date),
      effortHours: toNumber(row.estimated_effort_hours),
      elapsedDays: toNumber(row.estimated_elapsed_days),
      status: row.status,
      template,
      templateId: template?.id ?? null,
      templateOverrideId: null,
      requirements: {
        equipmentIds: explicitEquipmentIds,
        equipmentType,
        spaceIds: explicitSpaceIds,
        qualifications,
        prepMinutes: template?.prepMinutes ?? 0,
        estimatedTestMinutes: template?.testMinutes ?? 0,
      },
    };
  });
  for (const task of tasks) {
    const overrideId = templateOverrides instanceof Map ? templateOverrides.get(task.id) : templateOverrides[task.id];
    if (!overrideId) continue;
    const template = templateById.get(overrideId);
    if (!template) continue;
    task.template = template;
    task.templateId = template.id;
    task.templateOverrideId = template.id;
    task.requirements.prepMinutes = template.prepMinutes;
    task.requirements.estimatedTestMinutes = template.testMinutes;
    if (!task.requirements.equipmentIds.length && template.requiredEquipmentType) {
      const match = equipment.find((item) => item.type.toLowerCase() === String(template.requiredEquipmentType).toLowerCase());
      if (match) task.requirements.equipmentType = match.type;
    }
  }
  for (const task of tasks) {
    const override = options.taskOverrides?.[task.id];
    if (!override) continue;
    if (override.priority) task.priority = override.priority;
    if (override.dueDate) task.dueDate = parseInstant(override.dueDate);
    if (override.requestedStart) task.requestedStart = parseInstant(override.requestedStart);
    if (override.effortHours !== undefined && override.effortHours !== null) {
      task.effortHours = toNumber(override.effortHours);
    }
    task.overriddenFields = Object.keys(override).filter((key) => !['updatedAt', 'actor', 'reason', 'taskId'].includes(key));
  }
  const taskById = new Map(tasks.map((item) => [item.id, item]));

  const activities = raw.activities.map(normalizeActivity);
  const allocations = raw.allocations.map(normalizeAllocation);
  const history = raw.history.map((row) => ({
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
  const constraints = raw.constraints.map((row) => ({
    id: row.constraint_id,
    type: row.constraint_type,
    name: row.name,
    rule: row.rule,
    handling: row.handling,
  }));
  const requests = raw.requests.map((row) => ({
    id: row.request_id,
    orderId: row.order_id,
    templateId: row.template_id,
    name: row.test_request_name,
    priority: row.priority,
    requestedAt: parseInstant(row.requested_at),
    dueAt: parseInstant(row.due_at),
    sampleCount: toNumber(row.sample_count),
    summary: row.request_summary,
    ruleStatus: row.rule_status,
  }));
  const assignments = raw.assignments.map((row) => ({
    id: row.assignment_id,
    taskId: row.task_id,
    resourceId: row.resource_id,
    role: row.resource_role,
    status: row.assignment_status,
  }));

  const projects = [];
  for (const task of tasks) {
    if (projects.some((project) => project.id === task.projectId)) continue;
    projects.push({
      id: task.projectId,
      name: task.projectName,
      code: task.projectCode,
      priority: task.priority,
      taskIds: tasks.filter((item) => item.projectId === task.projectId).map((item) => item.id),
    });
  }

  const domain = {
    persons,
    personById,
    resources,
    equipment,
    equipmentById,
    spaces,
    spaceById,
    templates,
    templateById,
    tasks,
    taskById,
    activities,
    allocations,
    history,
    constraints,
    requests,
    assignments,
    projects,
    raw,
  };
  const config = normalizeUpgradeConfig(options.config ?? null);
  return applyUpgrade(domain, config);
}

export function personMatches(person, qualifications) {
  const required = qualifications ?? [];
  const missing = required.filter((qualification) => !person.qualifications.includes(qualification));
  const matched = required.filter((qualification) => person.qualifications.includes(qualification));
  return { matched, missing, qualified: required.length === 0 ? true : missing.length === 0, any: matched.length > 0 };
}

export function equipmentCandidatesForTask(domain, task) {
  const explicit = task.requirements.equipmentIds
    .map((id) => domain.equipmentById.get(id))
    .filter(Boolean);
  if (explicit.length > 0) {
    return { required: explicit, alternatives: domain.equipment.filter((item) => !explicit.some((entry) => entry.id === item.id) && item.type === explicit[0].type) };
  }
  const type = task.requirements.equipmentType;
  const matches = domain.equipment.filter((item) => !type || item.type === type);
  return { required: matches, alternatives: [] };
}

export function spaceCandidatesForTask(domain, task) {
  const explicit = task.requirements.spaceIds.map((id) => domain.spaceById.get(id)).filter(Boolean);
  if (explicit.length > 0) return explicit;
  if (task.template?.requiredSpaceId) {
    const templateSpace = domain.spaceById.get(task.template.requiredSpaceId);
    if (templateSpace) return [templateSpace];
  }
  return [];
}

export function personCandidatesForTask(domain, task) {
  const results = [];
  for (const person of domain.persons) {
    if (person.status !== 'Active') continue;
    const match = personMatches(person, task.requirements.qualifications);
    if (match.qualified || (isReviewTask(task) && match.any)) {
      results.push({ person, ...match });
    }
  }
  return results;
}

export function isReviewTask(task) {
  return /review/i.test(task.status) || task.status === 'Needs Method Review';
}

export function taskReadiness(domain, task) {
  if (isReviewTask(task)) {
    return { state: 'needs_review', label: '需方法审核', tone: 'warn' };
  }
  if (!task.requirements.equipmentIds.length && !task.requirements.equipmentType) {
    return { state: 'blocked', label: '缺设备要求', tone: 'error' };
  }
  const equipment = equipmentCandidatesForTask(domain, task).required.filter((item) => item.status === 'Operational');
  if (equipment.length === 0) return { state: 'blocked', label: '无可用设备', tone: 'error' };
  const persons = personCandidatesForTask(domain, task);
  if (persons.length === 0) return { state: 'blocked', label: '无合格人员', tone: 'error' };
  return { state: 'ready', label: '可排程', tone: 'ok' };
}

export function taskRisk(domain, task, now) {
  const daysLeft = Math.max(0, Math.ceil(diffHours(task.dueDate, now) / 24));
  const usableDays = Math.max(1, daysLeft + 1);
  const nominalCapacity = usableDays * 6;
  const readiness = taskReadiness(domain, task);
  if (readiness.state === 'blocked') {
    return { level: 'high', label: '阻塞', detail: readiness.label, daysLeft };
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
  return {
    id: task.id,
    name: task.name,
    method: task.method,
    projectId: task.projectId,
    projectName: task.projectName,
    projectCode: task.projectCode,
    testNo: task.testNo,
    priority: task.priority,
    status: task.status,
    readiness,
    risk,
    requestedStart: task.requestedStart?.toISOString() ?? null,
    dueDate: task.dueDate.toISOString(),
    dueLabel: formatDate(task.dueDate, true),
    effortHours: task.effortHours,
    elapsedDays: task.elapsedDays,
    qualifications: task.requirements.qualifications,
    equipmentIds: task.requirements.equipmentIds,
    equipmentType: task.requirements.equipmentType,
    spaceIds: task.requirements.spaceIds,
    templateId: task.templateId,
    templateName: task.template?.name ?? null,
    taskType: task.taskType ?? null,
    taskTypeLabel: task.taskTypeLabel ?? null,
    taskTypeReason: task.taskTypeReason ?? null,
    taskTypeConfirmed: task.taskTypeConfirmed === true,
    reservationMode: task.taskTypeRule?.exclusive ? 'exclusive' : task.taskTypeRule?.shareable ? 'shared' : 'unknown',
    sample: task.sample ?? null,
    sampleReadyAt: task.sample?.readyAt ?? null,
    orderIds: task.orderIds ?? [],
    specIds: task.specIds ?? [],
    overriddenFields: task.overriddenFields ?? [],
    candidateEquipment: equipment.required.map((item) => ({ id: item.id, name: item.name, status: item.status })),
    candidatePersons: persons.map((entry) => ({ id: entry.person.id, name: entry.person.name, missing: entry.missing })),
    allocatedHours: round1(sum(allocations.map((item) => item.load))),
    ...extra,
  };
}

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
  for (const entry of domain.activities) {
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
  const resource = domain.equipmentById.get(resourceId) ?? domain.spaceById.get(resourceId);
  if (!resource) return null;
  let used = 0;
  let peak = 0;
  let peakDay = null;
  const capacityPerDay = (resource.availableTo - resource.availableFrom) / 60;
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
    location: resource.location,
    status: resource.status,
    statusTone: equipmentStatusTone(resource.status),
    capabilities: resource.capabilities,
    calibrationDue: resource.calibrationDue,
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
    qualifications: person.qualifications,
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
    return first.dueDate - second.dueDate;
  });
}
