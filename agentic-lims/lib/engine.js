/**
 * Deterministic scheduling engine for the prototype.
 *
 * The engine never asks a model whether a plan is feasible. It greedily packs a
 * task into working days, subtracts existing person/equipment/space load and
 * person activity blocks, then evaluates the six hard constraints from the mock
 * rulebook. A model may explain the result; it may not overrule it.
 */
import {
  addDays,
  clamp,
  dateKey,
  dayLabel,
  diffHours,
  formatDate,
  formatDateTime,
  minToTime,
  parseInstant,
  round1,
  splitList,
  startOfDay,
  sum,
  timeToMin,
  unique,
} from './util.js';
import {
  calendarLoads,
  equipmentCandidatesForTask,
  isReviewTask,
  personCandidatesForTask,
  personMatches,
  spaceCandidatesForTask,
  taskReadiness,
} from './model.js';

const WORKDAY_LIMIT_HOURS = 8;
const HORIZON_DAYS = 28;

function isWeekend(dayKey) {
  const date = parseInstant(`${dayKey}T12:00:00+08:00`);
  const weekday = new Date(date.getTime() + 8 * 3600000).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function dayList(start, days) {
  const list = [];
  for (let index = 0; index < days; index += 1) {
    list.push(dateKey(addDays(startOfDay(start), index)));
  }
  return list;
}

function loadFor(map, id, day) {
  return map.get(`${id}|${day}`) ?? 0;
}

function equipmentUsableAt(equipment, day, downtime) {
  if (downtime && downtime.has(`${equipment.id}|${day}`)) return false;
  if (equipment.kind === 'space') return equipment.status === 'Available';
  if (equipment.status !== 'Operational') return false;
  if (equipment.calibrationDue && equipment.calibrationDue < day) return false;
  return true;
}

function resourceCapacityHours(equipment) {
  return Math.max(0, (equipment.availableTo - equipment.availableFrom) / 60);
}

function utilizationFor(ctx, resourceId, dayListValue, ignoreTaskId) {
  let used = 0;
  let capacity = 0;
  for (const day of dayListValue) {
    used += loadFor(ctx.loads.resource, resourceId, day);
    capacity += resourceCapacityHours(ctx.equipmentById.get(resourceId) ?? { availableFrom: 480, availableTo: 1080 });
  }
  return capacity > 0 ? used / capacity : 0;
}

/** Build the immutable context the engine reads: frozen clock, calendars and 28-day window. */
export function createEngineContext(domain, now = new Date(), options = {}) {
  const start = startOfDay(now);
  const days = dayList(start, HORIZON_DAYS);
  const loads = calendarLoads(domain, start, HORIZON_DAYS);
  const downtime = new Set(
    (options.downtime ?? [])
      .filter((entry) => entry && entry.equipmentId && entry.date)
      .map((entry) => `${entry.equipmentId}|${entry.date}`),
  );
  // A task being rescheduled must not fight its own proposed allocations.
  const ownPerson = new Map();
  const ownResource = new Map();
  for (const allocation of domain.allocations) {
    const key = `${allocation.taskId}|${allocation.date}`;
    if (allocation.personId) {
      const personKey = `${key}|${allocation.personId}`;
      ownPerson.set(personKey, (ownPerson.get(personKey) ?? 0) + allocation.load);
    }
    if (allocation.resourceId) {
      const resourceKey = `${key}|${allocation.resourceId}`;
      ownResource.set(resourceKey, (ownResource.get(resourceKey) ?? 0) + allocation.load);
    }
  }
  return {
    domain,
    now: parseInstant(now),
    start,
    days,
    loads,
    downtime,
    ownPerson,
    ownResource,
    equipmentById: domain.equipmentById,
    spaceById: domain.spaceById,
    personById: domain.personById,
  };
}

function ownLoad(map, taskId, day, resourceId) {
  return map.get(`${taskId}|${day}|${resourceId}`) ?? 0;
}

function freeCapacity(ctx, task, equipment, person, space, day) {
  const personLoad = Math.max(
    0,
    loadFor(ctx.loads.person, person.id, day) - ownLoad(ctx.ownPerson, task.id, day, person.id),
  );
  const personActivity = loadFor(ctx.loads.activity, person.id, day);
  const personFree = Math.max(0, person.dailyCapacityHours - personLoad - personActivity);
  const equipmentLoad = Math.max(
    0,
    loadFor(ctx.loads.resource, equipment.id, day) - ownLoad(ctx.ownResource, task.id, day, equipment.id),
  );
  const equipmentFree = Math.max(0, resourceCapacityHours(equipment) - equipmentLoad);
  let spaceFree = WORKDAY_LIMIT_HOURS;
  let spaceLoad = 0;
  if (space) {
    spaceLoad = Math.max(
      0,
      loadFor(ctx.loads.resource, space.id, day) - ownLoad(ctx.ownResource, task.id, day, space.id),
    );
    spaceFree = Math.max(0, resourceCapacityHours(space) - spaceLoad);
  }
  const workStart = Math.max(equipment.availableFrom, person.workStart, space?.availableFrom ?? 0);
  const workEnd = Math.min(equipment.availableTo, person.workEnd, space?.availableTo ?? 24 * 60);
  // Existing load is modeled as hours already consumed from the start of the day.
  const offsetMinutes = Math.max(personLoad + personActivity, equipmentLoad, spaceLoad) * 60;
  return {
    free: Math.min(personFree, equipmentFree, spaceFree, WORKDAY_LIMIT_HOURS),
    startMin: Math.max(workStart, workStart + offsetMinutes),
    endMin: workEnd,
    personFree,
    equipmentFree,
    spaceFree,
    personLoad,
    equipmentLoad,
    spaceLoad,
  };
}

function scheduleCombination(ctx, task, equipment, person, space, options = {}) {
  const segments = [];
  let remaining = task.effortHours;
  const earliest = options.earliestStart ? startOfDay(options.earliestStart) : ctx.now;
  const firstDay = dateKey(earliest);
  const dueKey = dateKey(task.dueDate);
  const limitDay = dateKey(addDays(Math.max(startOfDay(task.dueDate), startOfDay(ctx.now)), 10));
  const days = ctx.days.filter((day) => day >= firstDay && day <= limitDay);
  let lastDay = null;

  for (const day of days) {
    if (isWeekend(day)) continue;
    if (remaining <= 0) break;
    if (!equipmentUsableAt(equipment, day, ctx.downtime)) continue;
    const capacity = freeCapacity(ctx, task, equipment, person, space, day);
    if (capacity.free <= 0.1) continue;
    if (capacity.startMin >= capacity.endMin) continue;
    let dayEnd = capacity.endMin;
    if (options.avoidFridayAfternoon && dayLabel(`${day}T12:00:00+08:00`) === '周五') {
      dayEnd = Math.min(dayEnd, 12 * 60);
    }
    const available = Math.min(remaining, capacity.free, (dayEnd - capacity.startMin) / 60);
    if (available <= 0.1) continue;
    const hours = round1(available);
    const startMin = Math.round(capacity.startMin);
    const endMin = Math.round(capacity.startMin + hours * 60);
    segments.push({
      day,
      dateLabel: formatDate(`${day}T12:00:00+08:00`, true),
      weekday: dayLabel(`${day}T12:00:00+08:00`),
      start: minToTime(startMin),
      end: minToTime(endMin),
      startMin,
      endMin,
      hours,
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      personId: person.id,
      personName: person.name,
      spaceId: space?.id ?? null,
      spaceName: space?.name ?? null,
    });
    remaining = round1(remaining - hours);
    lastDay = day;
  }

  const feasible = remaining <= 0.1 && segments.length > 0;
  const startAt = segments.length > 0 ? parseInstant(`${segments[0].day}T${segments[0].start}:00+08:00`) : null;
  const endAt = segments.length > 0
    ? parseInstant(`${segments[segments.length - 1].day}T${segments[segments.length - 1].end}:00+08:00`)
    : null;
  const dueMarginHours = endAt ? diffHours(task.dueDate, endAt) : -1;
  const planDays = unique(segments.map((segment) => segment.day));

  const equipmentCandidates = equipmentCandidatesForTask(ctx.domain, task);
  const personMatch = personMatches(person, task.requirements.qualifications);
  const capacityOk = feasible;
  const calibrationOk = segments.every((segment) => equipmentUsableAt(equipment, segment.day, ctx.downtime));
  const calendarOk = segments.every((segment) => {
    const start = segment.startMin;
    const end = segment.endMin;
    const workStart = Math.max(equipment.availableFrom, person.workStart, space?.availableFrom ?? 0);
    const workEnd = Math.min(equipment.availableTo, person.workEnd, space?.availableTo ?? 24 * 60);
    return start >= workStart && end <= workEnd;
  });
  const spaceOk = task.requirements.spaceIds.length === 0 || Boolean(space);
  const capabilityOk = !task.requirements.equipmentType || equipment.type === task.requirements.equipmentType || task.requirements.equipmentIds.includes(equipment.id);

  const evaluations = [];
  evaluations.push({
    constraintId: 'HC-001',
    type: 'Hard',
    name: '设备能力匹配',
    result: capabilityOk ? 'pass' : 'fail',
    explanation: capabilityOk
      ? `${equipment.name}（${equipment.type}）满足任务要求`
      : `${equipment.name} 的类型/能力不满足 ${task.requirements.equipmentType}`,
  });
  evaluations.push({
    constraintId: 'HC-002',
    type: 'Hard',
    name: '人员资质',
    result: personMatch.qualified ? 'pass' : isReviewTask(task) ? 'warn' : 'fail',
    explanation: personMatch.qualified
      ? `${person.name} 具备 ${task.requirements.qualifications.join('、')}`
      : `${person.name} 缺少 ${personMatch.missing.join('、')}${isReviewTask(task) ? '；非标准方法允许人工复核' : ''}`,
  });
  evaluations.push({
    constraintId: 'HC-003',
    type: 'Hard',
    name: '设备状态与校准',
    result: calibrationOk ? 'pass' : 'fail',
    explanation: calibrationOk
      ? `${equipment.name} 在计划期间可用${equipment.calibrationDue ? `，校准有效期至 ${equipment.calibrationDue}` : ''}`
      : `${equipment.name} 状态为 ${equipment.status}，或校准在计划期内到期`,
  });
  evaluations.push({
    constraintId: 'HC-004',
    type: 'Hard',
    name: '资源时间冲突',
    result: capacityOk ? 'pass' : 'fail',
    explanation: capacityOk
      ? `已按每日剩余容量错峰安排，覆盖 ${planDays.length} 个工作日`
      : '在可执行窗口内无法找到足够的连续容量',
  });
  evaluations.push({
    constraintId: 'HC-005',
    type: 'Hard',
    name: '工作时段',
    result: calendarOk ? 'pass' : 'fail',
    explanation: calendarOk
      ? '所有时段均落在人员、设备与空间的工作时间内'
      : '存在超出工作时间的时段',
  });
  evaluations.push({
    constraintId: 'HC-006',
    type: 'Hard',
    name: '前处理空间',
    result: spaceOk ? 'pass' : 'fail',
    explanation: spaceOk
      ? space
        ? `前处理空间 ${space.name} 已预留`
        : '任务不需要前处理空间'
      : '任务要求前处理空间，但未找到可用空间',
  });
  if (isReviewTask(task)) {
    evaluations.push({
      constraintId: 'MR-001',
      type: 'Review',
      name: '方法审核',
      result: 'warn',
      explanation: '任务为非标准方法，需人工确认方法、资质与资源组合',
    });
  }
  if (endAt && endAt > task.dueDate) {
    evaluations.push({
      constraintId: 'SC-001',
      type: 'Soft',
      name: '交付期限',
      result: 'warn',
      explanation: `预计完成 ${formatDateTime(endAt)}，晚于交期 ${formatDate(task.dueDate, true)}；该方案满足硬约束但会延期`,
    });
  }

  const hardFailures = evaluations.filter((item) => item.type === 'Hard' && item.result === 'fail');
  const late = endAt ? endAt > task.dueDate : false;
  const review = isReviewTask(task);
  const status = hardFailures.length > 0 ? 'blocked' : review ? 'needs_review' : late ? 'at_risk' : 'feasible';
  const feasiblePlan = feasible && hardFailures.length === 0;

  const waitHours = startAt ? Math.max(0, diffHours(startAt, ctx.now)) : 0;
  const equipmentUtil = utilizationFor(ctx, equipment.id, planDays);
  const personUtil = personUtilization(ctx, person, planDays);
  const balance = 1 - clamp(Math.max(equipmentUtil, personUtil), 0, 1);
  const onTime = endAt && endAt <= task.dueDate ? 1 : 0;
  const slack = clamp(dueMarginHours / 48, 0, 1);
  const waitScore = 1 - clamp(waitHours / 120, 0, 1);
  const preference = options.preferredEquipmentId === equipment.id || options.preferredPersonId === person.id ? 1 : 0.45;
  const score = feasiblePlan
    ? Math.round(40 * onTime + 20 * slack + 15 * waitScore + 15 * balance + 10 * preference)
    : Math.round(10 * waitScore + 5 * balance);

  const risks = [];
  if (late) risks.push({ level: 'high', code: 'late', text: `预计延期 ${round1(-dueMarginHours / 24)} 天` });
  if (review) risks.push({ level: 'medium', code: 'review', text: '非标准方法，需方法审核后才能确认' });
  if (!late && dueMarginHours >= 0 && dueMarginHours < 8) risks.push({ level: 'medium', code: 'tight', text: `交期余量仅 ${round1(dueMarginHours)} 小时` });
  if (equipment.calibrationDue && diffHours(parseInstant(`${equipment.calibrationDue}T23:59:00+08:00`), ctx.now) < 7 * 24) {
    risks.push({ level: 'medium', code: 'calibration', text: `${equipment.name} 校准/维护到期临近（${equipment.calibrationDue}）` });
  }
  if (space && utilizationFor(ctx, space.id, planDays) > 0.85) {
    risks.push({ level: 'low', code: 'space', text: `${space.name} 在该时段接近满载` });
  }
  if (segments.length > 1) risks.push({ level: 'low', code: 'split', text: `任务跨 ${segments.length} 个工作日执行，存在切换成本` });
  const history = task.templateId ? ctx.domain.history.filter((item) => item.templateId === task.templateId) : [];
  if (history.length > 0) {
    const deviations = history.map((item) => item.actualMinutes - item.plannedMinutes);
    const averageDeviation = Math.round(sum(deviations) / deviations.length);
    risks.push({
      level: 'low',
      code: 'history',
      text: `同类历史 ${history.length} 个案例，平均实际时长偏差 ${averageDeviation > 0 ? '+' : ''}${averageDeviation} min（仅作参考，不替代设备与容量校验）`,
    });
  }

  const reasonParts = [];
  if (endAt) reasonParts.push(`${formatDateTime(startAt)} → ${formatDateTime(endAt)}`);
  reasonParts.push(`${equipment.name} + ${person.name}${space ? ` + ${space.name}` : ''}`);
  if (capabilityOk && calibrationOk) reasonParts.push('设备能力与校准状态均满足硬约束');
  if (late) reasonParts.push('交付期限不满足，但硬约束全部通过');
  if (review) reasonParts.push('非标准方法需人工审核');

  return {
    id: null,
    taskId: task.id,
    taskName: task.name,
    projectName: task.projectName,
    priority: task.priority,
    strategy: options.strategy ?? 'candidate',
    strategyLabel: options.strategyLabel ?? '候选方案',
    feasible: feasiblePlan,
    status,
    statusLabel:
      status === 'feasible' ? '可行' : status === 'at_risk' ? '可行但有风险' : status === 'needs_review' ? '需方法审核' : '不可行',
    score,
    scoreBreakdown: [
      { key: 'onTime', label: '交付及时性', value: Math.round(40 * onTime), max: 40 },
      { key: 'slack', label: '交期余量', value: Math.round(20 * slack), max: 20 },
      { key: 'wait', label: '等待时间', value: Math.round(15 * waitScore), max: 15 },
      { key: 'balance', label: '负载均衡', value: Math.round(15 * balance), max: 15 },
      { key: 'preference', label: '资源偏好', value: Math.round(10 * preference), max: 10 },
    ],
    segments,
    resources: {
      equipment: { id: equipment.id, name: equipment.name, type: equipment.type, status: equipment.status },
      person: { id: person.id, name: person.name, qualifications: person.qualifications },
      space: space ? { id: space.id, name: space.name } : null,
    },
    startAt: startAt?.toISOString() ?? null,
    endAt: endAt?.toISOString() ?? null,
    startLabel: startAt ? formatDateTime(startAt) : null,
    endLabel: endAt ? formatDateTime(endAt) : null,
    dueAt: task.dueDate.toISOString(),
    dueLabel: formatDate(task.dueDate, true),
    dueMarginHours: startAt ? round1(dueMarginHours) : null,
    waitHours: round1(waitHours),
    totalHours: round1(task.effortHours - Math.max(0, remaining)),
    remainingHours: round1(Math.max(0, remaining)),
    evaluations,
    risks,
    rationale: reasonParts,
    utilization: {
      equipment: Math.round(equipmentUtil * 100),
      person: Math.round(personUtil * 100),
    },
    assumptions: [
      '人员工时与设备占用按小时折算；现有排程占用从当日工作时段起点扣减。',
      '原型冻结演示时钟为 2026-10-27 08:00，周末不排程。',
    ],
    generatedAt: new Date().toISOString(),
  };
}

function personUtilization(ctx, person, days) {
  if (!days.length) return 0;
  let used = 0;
  let capacity = 0;
  for (const day of days) {
    used += loadFor(ctx.loads.person, person.id, day) + loadFor(ctx.loads.activity, person.id, day);
    capacity += person.dailyCapacityHours;
  }
  return capacity > 0 ? used / capacity : 0;
}

function comboKey(combination) {
  return `${combination.equipment.id}|${combination.person.id}|${combination.space?.id ?? '-'}`;
}

function describeCombo(combination) {
  return `${combination.equipment.name} + ${combination.person.name}${combination.space ? ` + ${combination.space.name}` : ''}`;
}

/**
 * Generate candidate plans for one task.
 * @param {ReturnType<typeof createEngineContext>} ctx
 * @param {object} task
 * @param {{count?: number, preferredEquipmentId?: string, preferredPersonId?: string, avoidFridayAfternoon?: boolean, earliestStart?: string}} [options]
 */
export function generatePlans(ctx, task, options = {}) {
  const count = clamp(Number(options.count) || 3, 1, 5);
  const equipment = equipmentCandidatesForTask(ctx.domain, task);
  const persons = personCandidatesForTask(ctx.domain, task);
  const spaces = spaceCandidatesForTask(ctx.domain, task);
  const usableEquipment = equipment.required.filter((item) => equipmentUsableAt(item, dateKey(ctx.now), null));
  const excluded = [];

  for (const item of equipment.required) {
    if (!usableEquipment.some((entry) => entry.id === item.id)) {
      excluded.push({
        resourceId: item.id,
        resourceName: item.name,
        reasons: explainEquipmentReasons(ctx, item, task),
      });
    }
  }
  for (const entry of persons) {
    if (!entry.qualified && !isReviewTask(task)) {
      excluded.push({
        resourceId: entry.person.id,
        resourceName: entry.person.name,
        reasons: [`缺少资质：${entry.missing.join('、')}`],
      });
    }
  }

  const combinations = [];
  for (const item of usableEquipment) {
    for (const entry of persons) {
      const spaceOptions = spaces.length > 0 ? spaces : [null];
      for (const space of spaceOptions) {
        combinations.push({ equipment: item, person: entry.person, space });
      }
    }
  }

  const drafts = combinations.slice(0, 36).map((combination) =>
    scheduleCombination(ctx, task, combination.equipment, combination.person, combination.space, {
      ...options,
      preferredEquipmentId: options.preferredEquipmentId,
      preferredPersonId: options.preferredPersonId,
    }),
  );

  const feasible = drafts.filter((plan) => plan.feasible);

  const strategyPick = (strategy, label, selector) => {
    if (feasible.length === 0) return null;
    const sorted = [...feasible].sort(selector);
    const pick = sorted[0];
    if (!pick) return null;
    return { ...pick, strategy, strategyLabel: label };
  };

  const picks = [];
  const used = new Set();
  const addPick = (candidate) => {
    if (!candidate) return;
    const key = comboKey({
      equipment: { id: candidate.resources.equipment.id },
      person: { id: candidate.resources.person.id },
      space: candidate.resources.space ? { id: candidate.resources.space.id } : null,
    });
    if (used.has(key)) return;
    used.add(key);
    picks.push(candidate);
  };

  addPick(strategyPick('fastest', '最快完成', (a, b) => parseInstant(a.endAt) - parseInstant(b.endAt)));
  addPick(
    strategyPick(
      'balanced',
      '负载均衡',
      (a, b) =>
        Math.max(a.utilization.equipment, a.utilization.person) -
          Math.max(b.utilization.equipment, b.utilization.person) ||
        parseInstant(a.endAt) - parseInstant(b.endAt),
    ),
  );
  addPick(
    strategyPick(
      'preferred',
      options.preferredEquipmentId ? '设备偏好' : '资源切换最少',
      (a, b) => {
        const prefA = a.resources.equipment.id === options.preferredEquipmentId ? -1000 : 0;
        const prefB = b.resources.equipment.id === options.preferredEquipmentId ? -1000 : 0;
        return prefA - prefB || Math.max(a.utilization.equipment, a.utilization.person) - Math.max(b.utilization.equipment, b.utilization.person);
      },
    ),
  );
  for (const plan of [...feasible].sort((a, b) => b.score - a.score)) {
    if (picks.length >= count) break;
    addPick({ ...plan, strategy: 'score', strategyLabel: '综合评分' });
  }

  const selected = picks.slice(0, count).map((plan, index) => ({
    ...plan,
    id: `PLAN-${task.id}-${index + 1}`,
    optionLabel: String.fromCharCode(65 + index),
  }));

  let diagnostics = [];
  if (selected.length === 0) {
    diagnostics = diagnoseInfeasible(ctx, task, equipment, persons, spaces);
  }

  return {
    task: {
      id: task.id,
      name: task.name,
      projectName: task.projectName,
      priority: task.priority,
      dueDate: task.dueDate.toISOString(),
      effortHours: task.effortHours,
      qualifications: task.requirements.qualifications,
      equipmentType: task.requirements.equipmentType,
      spaceIds: task.requirements.spaceIds,
      status: task.status,
    },
    plans: selected,
    diagnostics,
    excluded,
    candidates: {
      equipment: equipment.required.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        status: item.status,
        usable: equipmentUsableAt(item, dateKey(ctx.now), ctx.downtime),
        reasons: equipmentUsableAt(item, dateKey(ctx.now), ctx.downtime) ? [] : explainEquipmentReasons(ctx, item, task),
      })),
      alternatives: equipment.alternatives.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        usable: equipmentUsableAt(item, dateKey(ctx.now), ctx.downtime),
      })),
      persons: persons.map((entry) => ({
        id: entry.person.id,
        name: entry.person.name,
        matched: entry.matched,
        missing: entry.missing,
      })),
      spaces: spaces.map((item) => ({ id: item.id, name: item.name })),
    },
    generatedAt: new Date().toISOString(),
  };
}

function buildTaskBefore(ctx, task) {
  const rows = ctx.domain.allocations.filter((item) => item.taskId === task.id);
  const byDay = new Map();
  for (const row of rows) {
    const entry = byDay.get(row.date) ?? {
      day: row.date,
      personHours: 0,
      resourceHours: 0,
      personId: null,
      equipmentId: null,
      spaceId: null,
    };
    if (row.type === 'Person effort') {
      entry.personHours = round1(entry.personHours + row.load);
      entry.personId = entry.personId ?? row.personId;
    } else {
      entry.resourceHours = round1(entry.resourceHours + row.load);
      if (row.resourceId?.startsWith('SP-')) entry.spaceId = entry.spaceId ?? row.resourceId;
      else entry.equipmentId = entry.equipmentId ?? row.resourceId;
    }
    byDay.set(row.date, entry);
  }
  const segments = [...byDay.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((entry) => {
      const hours = round1(Math.max(entry.personHours, entry.resourceHours));
      const startMin = 8 * 60;
      return {
        day: entry.day,
        dateLabel: formatDate(`${entry.day}T12:00:00+08:00`, true),
        start: minToTime(startMin),
        end: minToTime(startMin + hours * 60),
        hours,
        personId: entry.personId,
        equipmentId: entry.equipmentId,
        spaceId: entry.spaceId,
      };
    });
  const startAt = segments.length > 0 ? parseInstant(`${segments[0].day}T08:00:00+08:00`) : null;
  const last = segments[segments.length - 1];
  const endAt = last ? parseInstant(`${last.day}T${last.end}:00+08:00`) : null;
  return {
    segments,
    startAt: startAt?.toISOString() ?? null,
    endAt: endAt?.toISOString() ?? null,
    startLabel: startAt ? formatDateTime(startAt) : null,
    endLabel: endAt ? formatDateTime(endAt) : null,
    dayCount: segments.length,
    note: '当前负荷只有每日小时数，时间按 08:00 起排展示',
  };
}

/**
 * Explain and re-plan the tasks that occupy one equipment on one day.
 * A downtime event is a hard availability block for that equipment/day; the
 * engine re-runs every affected task against the remaining resources.
 * @param {ReturnType<typeof createEngineContext>} ctx
 * @param {string} equipmentId
 * @param {string} date
 * @param {string} [reason]
 */
export function analyzeDowntime(ctx, equipmentId, date, reason = '') {
  const equipment = ctx.equipmentById.get(equipmentId);
  if (!equipment) return { found: false, equipmentId };
  const day = dateKey(date);
  const downtimeKey = `${equipmentId}|${day}`;
  const affectedIds = unique(
    ctx.domain.allocations.filter((item) => item.resourceId === equipmentId && item.date === day).map((item) => item.taskId),
  );
  const downCtx = { ...ctx, downtime: new Set([...ctx.downtime, downtimeKey]) };
  const tasks = affectedIds
    .map((taskId) => {
      const task = ctx.domain.taskById.get(taskId);
      if (!task) return null;
      const before = buildTaskBefore(ctx, task);
      const result = generatePlans(downCtx, task, { count: 2 });
      const recommended = result.plans[0] ?? null;
      const beforeEnd = before.endAt ? parseInstant(before.endAt) : null;
      const deltaHours = recommended && beforeEnd ? round1(diffHours(recommended.endAt, beforeEnd)) : null;
      const late = recommended ? parseInstant(recommended.endAt) > task.dueDate : null;
      const severity = !recommended ? 'blocked' : late ? 'late' : deltaHours > 0 ? 'delayed' : 'ok';
      return {
        task: {
          id: task.id,
          name: task.name,
          projectName: task.projectName,
          priority: task.priority,
          status: task.status,
          review: isReviewTask(task),
          dueDate: task.dueDate.toISOString(),
          dueLabel: formatDate(task.dueDate, true),
          effortHours: task.effortHours,
        },
        before,
        recommended: recommended
          ? {
              id: recommended.id,
              strategyLabel: recommended.strategyLabel,
              status: recommended.status,
              statusLabel: recommended.statusLabel,
              feasible: recommended.feasible,
              score: recommended.score,
              startAt: recommended.startAt,
              endAt: recommended.endAt,
              startLabel: recommended.startLabel,
              endLabel: recommended.endLabel,
              dueMarginHours: recommended.dueMarginHours,
              resources: recommended.resources,
              segments: recommended.segments,
              risks: recommended.risks,
              evaluations: recommended.evaluations,
            }
          : null,
        alternatives: result.plans.slice(1).map((plan) => ({
          id: plan.id,
          strategyLabel: plan.strategyLabel,
          status: plan.status,
          score: plan.score,
          startAt: plan.startAt,
          endAt: plan.endAt,
          startLabel: plan.startLabel,
          endLabel: plan.endLabel,
          resources: plan.resources,
        })),
        diagnostics: result.diagnostics,
        deltaHours,
        late,
        severity,
      };
    })
    .filter(Boolean);

  const replannable = tasks.filter((entry) => entry.recommended);
  const lateTasks = replannable.filter((entry) => entry.late);
  const blocked = tasks.filter((entry) => !entry.recommended);
  return {
    found: true,
    equipment: {
      id: equipment.id,
      name: equipment.name,
      type: equipment.type,
      status: equipment.status,
      location: equipment.location,
      calibrationDue: equipment.calibrationDue,
      workHours: `${minToTime(equipment.availableFrom)}-${minToTime(equipment.availableTo)}`,
    },
    date: day,
    dateLabel: formatDate(`${day}T12:00:00+08:00`, true),
    reason,
    tasks,
    summary: {
      affected: tasks.length,
      replannable: replannable.length,
      blocked: blocked.length,
      late: lateTasks.length,
      delayed: replannable.filter((entry) => entry.severity === 'delayed').length,
      delayHours: round1(sum(replannable.map((entry) => Math.max(0, entry.deltaHours ?? 0)))),
    },
    generatedAt: new Date().toISOString(),
  };
}

function compactPlanForCompare(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    strategyLabel: plan.strategyLabel,
    status: plan.status,
    statusLabel: plan.statusLabel,
    score: plan.score,
    startAt: plan.startAt,
    endAt: plan.endAt,
    startLabel: plan.startLabel,
    endLabel: plan.endLabel,
    dueAt: plan.dueAt,
    dueMarginHours: plan.dueMarginHours,
    resources: plan.resources,
    segments: plan.segments,
    risks: plan.risks,
    evaluations: plan.evaluations,
    utilization: plan.utilization,
  };
}

/**
 * Compare an existing plan with a re-planned candidate.
 * This is deliberately a data comparison, not a model narrative: the UI and the
 * chat tool show the same deltas.
 * @param {object} before - the previously selected plan
 * @param {object|null} after - the first candidate from the new run
 */
export function comparePlans(before, after) {
  if (!before) return null;
  const oldPlan = compactPlanForCompare(before);
  const newPlan = compactPlanForCompare(after);
  const oldDays = new Set((before.segments ?? []).map((segment) => segment.day));
  const newDays = new Set((after?.segments ?? []).map((segment) => segment.day));
  const daysAdded = [...newDays].filter((day) => !oldDays.has(day)).sort();
  const daysRemoved = [...oldDays].filter((day) => !newDays.has(day)).sort();
  const oldRisks = new Set((before.risks ?? []).map((risk) => risk.text));
  const newRisks = new Set((after?.risks ?? []).map((risk) => risk.text));
  const resourceChanges = [];
  for (const [role, label] of [['equipment', '设备'], ['person', '人员'], ['space', '空间']]) {
    const from = before.resources?.[role]?.name ?? null;
    const to = after?.resources?.[role]?.name ?? null;
    if (from !== to) resourceChanges.push({ role, label, from, to });
  }
  return {
    before: oldPlan,
    after: newPlan,
    completionDeltaHours: after ? round1(diffHours(after.endAt, before.endAt)) : null,
    scoreDelta: after ? after.score - before.score : null,
    dueMarginDelta: after ? round1((after.dueMarginHours ?? 0) - (before.dueMarginHours ?? 0)) : null,
    lateBefore: before.endAt ? parseInstant(before.endAt) > parseInstant(before.dueAt ?? before.endAt) : false,
    lateAfter: after ? parseInstant(after.endAt) > parseInstant(after.dueAt ?? after.endAt) : null,
    resourceChanges,
    daysAdded: daysAdded.map((day) => formatDate(`${day}T12:00:00+08:00`, true)),
    daysRemoved: daysRemoved.map((day) => formatDate(`${day}T12:00:00+08:00`, true)),
    risksAdded: [...newRisks].filter((text) => !oldRisks.has(text)),
    risksRemoved: [...oldRisks].filter((text) => !newRisks.has(text)),
  };
}

function diagnoseInfeasible(ctx, task, equipment, persons) {
  const diagnostics = [];
  if (equipment.required.length === 0) {
    diagnostics.push({ code: 'no_equipment_requirement', text: '任务没有指定设备，且无法从方法推导设备类型' });
  }
  if (persons.length === 0) {
    diagnostics.push({ code: 'no_qualified_person', text: `没有人员同时具备 ${task.requirements.qualifications.join('、') || '所需资质'}` });
  }
  for (const item of equipment.required) {
    if (!equipmentUsableAt(item, dateKey(ctx.now), null)) {
      diagnostics.push({
        code: 'equipment_blocked',
        text: `${item.name} 当前不可用：${explainEquipmentReasons(ctx, item, task).join('；')}`,
        resourceId: item.id,
      });
    }
  }
  if (diagnostics.length === 0) {
    diagnostics.push({
      code: 'no_capacity',
      text: '在交期后的 10 天窗口内，无法为全部必需资源找到足够容量；可调整交期、拆分任务或增加班次',
    });
  }
  return diagnostics;
}

export function explainEquipmentReasons(ctx, equipment, task) {
  const reasons = [];
  if (equipment.kind === 'equipment' && equipment.status !== 'Operational') {
    reasons.push(`状态为「${equipment.status}」，规则 HC-003 要求设备处于可运行状态`);
  }
  if (equipment.kind === 'space' && equipment.status !== 'Available') {
    reasons.push(`空间状态为「${equipment.status}」`);
  }
  if (ctx.downtime?.has(`${equipment.id}|${dateKey(ctx.now)}`)) {
    reasons.push('今天处于计划停机窗口（影响分析中已登记）');
  }
  if (task && task.requirements.equipmentType && equipment.kind === 'equipment' && equipment.type !== task.requirements.equipmentType) {
    reasons.push(`设备类型为 ${equipment.type}，任务要求 ${task.requirements.equipmentType}（HC-001）`);
  }
  if (task && task.requirements.equipmentIds.length > 0 && !task.requirements.equipmentIds.includes(equipment.id)) {
    reasons.push('不是该任务指定的设备；替换需人工确认');
  }
  if (equipment.calibrationDue) {
    const dueSoon = diffHours(parseInstant(`${equipment.calibrationDue}T23:59:00+08:00`), ctx.now) < 0;
    if (dueSoon) reasons.push(`校准/维护到期日 ${equipment.calibrationDue} 已过（HC-003）`);
  }
  if (task) {
    const allocations = ctx.domain.allocations.filter(
      (item) => item.resourceId === equipment.id && item.taskId !== task.id && item.load > 0,
    );
    const days = unique(allocations.map((item) => item.date)).slice(0, 4);
    if (days.length > 0) reasons.push(`已有其他任务占用：${days.join('、')}${allocations.length > 4 ? ' 等' : ''}`);
  }
  if (reasons.length === 0) reasons.push('当前未发现硬约束冲突');
  return reasons;
}

/** Count and list the appointments that occupy one equipment on one day. */
export function equipmentBookings(ctx, equipmentId, date) {
  const equipment = ctx.equipmentById.get(equipmentId);
  if (!equipment) return { found: false, equipmentId };
  const day = dateKey(date);
  const rows = ctx.domain.allocations.filter((item) => item.resourceId === equipmentId && item.date === day);
  const taskIds = unique(rows.map((item) => item.taskId));
  const tasks = taskIds.map((taskId) => {
    const task = ctx.domain.taskById.get(taskId);
    const allocations = rows.filter((item) => item.taskId === taskId);
    const hours = round1(sum(allocations.map((item) => item.load)));
    const personIds = unique(
      ctx.domain.allocations
        .filter((item) => item.taskId === taskId && item.date === day && item.personId)
        .map((item) => item.personId),
    );
    return {
      id: taskId,
      name: task?.name ?? taskId,
      priority: task?.priority ?? 'Normal',
      status: task?.status ?? '—',
      hours,
      personIds,
      personNames: personIds.map((personId) => ctx.domain.personById.get(personId)?.name ?? personId),
    };
  });
  const totalHours = round1(sum(tasks.map((task) => task.hours)));
  const capacity = (equipment.availableTo - equipment.availableFrom) / 60;
  return {
    found: true,
    equipment: {
      id: equipment.id,
      name: equipment.name,
      type: equipment.type,
      status: equipment.status,
      location: equipment.location,
      workHours: `${minToTime(equipment.availableFrom)}-${minToTime(equipment.availableTo)}`,
    },
    date: day,
    dateLabel: formatDate(`${day}T12:00:00+08:00`, true),
    count: tasks.length,
    totalHours,
    capacity: round1(capacity),
    utilization: capacity > 0 ? Math.round((totalHours / capacity) * 100) : 0,
    downtime: ctx.downtime.has(`${equipmentId}|${day}`),
    tasks,
    generatedAt: new Date().toISOString(),
  };
}

/** Explain one resource for the UI and the chat tool, including alternatives. */
export function explainResource(ctx, resourceId, taskId) {
  const resource = ctx.equipmentById.get(resourceId) ?? ctx.spaceById.get(resourceId);
  if (!resource) return { found: false, resourceId };
  const task = taskId ? ctx.domain.taskById.get(taskId) : null;
  const reasons = explainEquipmentReasons(ctx, resource, task);
  const usable = equipmentUsableAt(resource, dateKey(ctx.now), ctx.downtime);
  let alternatives = [];
  if (resource.kind === 'equipment') {
    alternatives = ctx.domain.equipment
      .filter((item) => item.id !== resource.id && item.type === resource.type && equipmentUsableAt(item, dateKey(ctx.now), null))
      .map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        status: item.status,
        calibrationDue: item.calibrationDue,
        note: task ? `同类型可替代；需重新校验资质、精度与时间冲突` : '同类型可用',
      }));
  }
  const occupied = ctx.domain.allocations
    .filter((item) => item.resourceId === resource.id)
    .map((item) => ({ taskId: item.taskId, date: item.date, hours: item.load, type: item.type }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12);
  return {
    found: true,
    resource: {
      id: resource.id,
      name: resource.name,
      type: resource.type,
      kind: resource.kind,
      status: resource.status,
      calibrationDue: resource.calibrationDue,
      capabilities: resource.capabilities,
      location: resource.location,
      workHours: `${minToTime(resource.availableFrom)}-${minToTime(resource.availableTo)}`,
    },
    task: task ? { id: task.id, name: task.name } : null,
    usable,
    reasons,
    alternatives,
    occupied,
    generatedAt: new Date().toISOString(),
  };
}

/** Build the dashboard's compact 14-day task timeline. */
export function buildTimeline(domain, ctx, days = 16) {
  const start = ctx.start;
  const dayKeys = dayList(start, days);
  const bars = domain.tasks.map((task) => {
    const startKey = dateKey(task.requestedStart ?? ctx.now);
    const dueKey = dateKey(task.dueDate);
    const from = dayKeys.findIndex((day) => day >= startKey);
    const to = dayKeys.findIndex((day) => day >= dueKey);
    return {
      id: task.id,
      name: task.name,
      priority: task.priority,
      from: from >= 0 ? from : -1,
      to: to >= 0 ? to : dayKeys.length - 1,
      start: startKey,
      due: dueKey,
      status: task.status,
    };
  });
  return { days: dayKeys.map((day) => ({ key: day, label: formatDate(`${day}T12:00:00+08:00`), weekday: dayLabel(`${day}T12:00:00+08:00`) })), bars };
}

/** Compute utilization, workload, due-risk and bottleneck data for the analytics page. */
export function computeAnalytics(domain, ctx, recentAudit = []) {
  const windowDays = 14;
  const days = dayList(ctx.start, windowDays);
  const equipment = domain.equipment.map((item) => {
    let used = 0;
    let peak = 0;
    const perDay = [];
    for (const day of days) {
      const load = loadFor(ctx.loads.resource, item.id, day);
      used += load;
      peak = Math.max(peak, load);
      perDay.push({ day, load: round1(load) });
    }
    const capacity = resourceCapacityHours(item) * windowDays;
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      status: item.status,
      used: round1(used),
      capacity: round1(capacity),
      utilization: capacity > 0 ? Math.round((used / capacity) * 100) : 0,
      peak: round1(peak),
      perDay,
    };
  });
  const totalEquipmentUsed = sum(equipment.map((item) => item.used));
  for (const item of equipment) item.loadShare = totalEquipmentUsed > 0 ? Math.round((item.used / totalEquipmentUsed) * 100) : 0;
  const persons = domain.persons.map((person) => {
    let load = 0;
    let blocked = 0;
    for (const day of days) {
      load += loadFor(ctx.loads.person, person.id, day);
      blocked += loadFor(ctx.loads.activity, person.id, day);
    }
    const capacity = person.dailyCapacityHours * windowDays;
    return {
      id: person.id,
      name: person.name,
      team: person.team,
      load: round1(load),
      blocked: round1(blocked),
      capacity,
      utilization: capacity > 0 ? Math.round((load / capacity) * 100) : 0,
    };
  });
  const totalPersonLoad = sum(persons.map((person) => person.load));
  for (const person of persons) person.loadShare = totalPersonLoad > 0 ? Math.round((person.load / totalPersonLoad) * 100) : 0;
  const buckets = [
    { key: 'overdue', label: '已逾期', min: -Infinity, max: 0 },
    { key: 'd0_2', label: '0-2 天', min: 0, max: 2 },
    { key: 'd3_7', label: '3-7 天', min: 2, max: 7 },
    { key: 'd8_14', label: '8-14 天', min: 7, max: 14 },
    { key: 'later', label: '14 天以后', min: 14, max: Infinity },
  ].map((bucket) => ({ ...bucket, count: 0, urgent: 0, high: 0, normal: 0 }));
  const riskTasks = [];
  for (const task of domain.tasks) {
    const daysLeft = diffHours(task.dueDate, ctx.now) / 24;
    const bucket = buckets.find((entry) => daysLeft >= entry.min && daysLeft < entry.max) ?? buckets[buckets.length - 1];
    bucket.count += 1;
    if (task.priority === 'Urgent') bucket.urgent += 1;
    else if (task.priority === 'High') bucket.high += 1;
    else bucket.normal += 1;
    const capacity = Math.max(1, Math.ceil(daysLeft) + 1) * 6;
    const loadPct = Math.round((task.effortHours / capacity) * 100);
    if (loadPct >= 65 || daysLeft < 1) {
      riskTasks.push({
        id: task.id,
        name: task.name,
        projectName: task.projectName,
        priority: task.priority,
        dueDate: task.dueDate.toISOString(),
        daysLeft: round1(daysLeft),
        loadPct,
        level: loadPct >= 100 || daysLeft < 0 ? 'high' : 'medium',
        reason: loadPct >= 100 ? '工作量超过交期前可用容量' : '交期紧、可用容量有限',
      });
    }
  }
  for (const task of domain.tasks) {
    if (!isReviewTask(task) || riskTasks.some((entry) => entry.id === task.id)) continue;
    riskTasks.push({
      id: task.id,
      name: task.name,
      projectName: task.projectName,
      priority: task.priority,
      dueDate: task.dueDate.toISOString(),
      daysLeft: round1(diffHours(task.dueDate, ctx.now) / 24),
      loadPct: Math.round((task.effortHours / (Math.max(1, Math.ceil(diffHours(task.dueDate, ctx.now) / 24) + 1) * 6)) * 100),
      level: 'medium',
      reason: '非标准方法，需方法审核后才能确认',
    });
  }
  riskTasks.sort((a, b) => b.loadPct - a.loadPct);
  const top = [...equipment].sort((a, b) => b.utilization - a.utilization)[0];
  const bottleneck = top
    ? {
        resourceId: top.id,
        resourceName: top.name,
        type: top.type,
        utilization: top.utilization,
        text: `${top.name}（${top.type}）未来 ${windowDays} 天利用率最高，约 ${top.utilization}%，峰值单日 ${top.peak}h；是当前最可能的排程瓶颈。`,
      }
    : null;
  const byPriority = ['Urgent', 'High', 'Normal', 'Low'].map((priority) => ({
    priority,
    count: domain.tasks.filter((task) => task.priority === priority).length,
  }));
  const byTeam = [...new Set(domain.persons.map((person) => person.team))].map((team) => {
    const members = persons.filter((person) => person.team === team);
    return {
      team,
      load: round1(sum(members.map((person) => person.load))),
      capacity: round1(sum(members.map((person) => person.capacity))),
      utilization: Math.round((sum(members.map((person) => person.load)) / Math.max(1, sum(members.map((person) => person.capacity)))) * 100),
    };
  });
  const totalCapacity = sum(equipment.map((item) => item.capacity));
  const totalUsed = sum(equipment.map((item) => item.used));
  return {
    windowDays,
    days: days.map((day) => ({ key: day, label: formatDate(`${day}T12:00:00+08:00`) })),
    equipment,
    persons,
    teams: byTeam,
    dueBuckets: buckets,
    priorityMix: byPriority,
    bottleneck,
    riskTasks,
    summary: {
      equipmentUtilization: totalCapacity > 0 ? Math.round((totalUsed / totalCapacity) * 100) : 0,
      totalEquipmentHours: round1(totalUsed),
      totalCapacityHours: round1(totalCapacity),
      tasksAtRisk: riskTasks.length,
      blockedEquipment: domain.equipment.filter((item) => item.status !== 'Operational').length,
    },
    recentAudit,
  };
}

/** Overview payload shared by the dashboard and the chat tool. */
const PROJECT_PRIORITY_ORDER = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

function projectTaskSummary(domain, task) {
  return {
    id: task.id,
    name: task.name,
    method: task.method,
    priority: task.priority,
    status: task.status,
    dueDate: task.dueDate.toISOString(),
    dueLabel: formatDate(task.dueDate, true),
    effortHours: task.effortHours,
    review: isReviewTask(task),
    readiness: taskReadiness(domain, task).state,
    templateId: task.templateId,
    templateOverrideId: task.templateOverrideId ?? null,
    templateName: task.template?.name ?? null,
    methodCode: task.template?.methodCode ?? null,
    equipmentIds: task.requirements.equipmentIds,
    equipmentType: task.requirements.equipmentType,
    spaceIds: task.requirements.spaceIds,
    qualifications: task.requirements.qualifications,
  };
}

function projectTemplateGroup(task) {
  return {
    key: task.templateId ?? 'custom',
    templateId: task.templateId,
    templateName: task.template?.name ?? '未匹配模板（需方法确认）',
    methodCode: task.template?.methodCode ?? 'CUSTOM',
    notes: task.template?.notes ?? '',
  };
}

export function projectSummaries(domain, ctx, testPlans = []) {
  return domain.projects
    .map((project) => {
      const tasks = project.taskIds.map((id) => domain.taskById.get(id)).filter(Boolean);
      const groups = new Map();
      for (const task of tasks) {
        const meta = projectTemplateGroup(task);
        if (!groups.has(meta.key)) groups.set(meta.key, { ...meta, taskCount: 0, effortHours: 0, reviewCount: 0 });
        const group = groups.get(meta.key);
        group.taskCount += 1;
        group.effortHours = round1(group.effortHours + task.effortHours);
        if (isReviewTask(task)) group.reviewCount += 1;
      }
      const dueDates = tasks.map((task) => task.dueDate).sort((a, b) => a - b);
      const priority = tasks.map((task) => task.priority).sort((a, b) => (PROJECT_PRIORITY_ORDER[a] ?? 4) - (PROJECT_PRIORITY_ORDER[b] ?? 4))[0] ?? 'Normal';
      const reviewCount = tasks.filter(isReviewTask).length;
      const riskCount = tasks.filter((task) => isReviewTask(task) || diffHours(task.dueDate, ctx.now) < 72).length;
      return {
        id: project.id,
        name: project.name,
        code: project.code,
        priority,
        taskCount: tasks.length,
        effortHours: round1(sum(tasks.map((task) => task.effortHours))),
        dueFrom: dueDates[0]?.toISOString() ?? null,
        dueTo: dueDates[dueDates.length - 1]?.toISOString() ?? null,
        dueFromLabel: dueDates[0] ? formatDate(dueDates[0]) : '—',
        dueToLabel: dueDates.length ? formatDate(dueDates[dueDates.length - 1], true) : '—',
        reviewCount,
        riskCount,
        templates: [...groups.values()],
        templateNames: [...groups.values()].map((group) => group.templateName),
        testPlanCount: testPlans.filter((plan) => plan.projectId === project.id).length,
        taskIds: tasks.map((task) => task.id),
      };
    })
    .sort((a, b) => (PROJECT_PRIORITY_ORDER[a.priority] ?? 4) - (PROJECT_PRIORITY_ORDER[b.priority] ?? 4) || a.dueToLabel.localeCompare(b.dueToLabel));
}

export function projectDetail(domain, ctx, projectId, testPlans = []) {
  const project = domain.projects.find((item) => item.id === projectId);
  if (!project) return null;
  const tasks = project.taskIds.map((id) => domain.taskById.get(id)).filter(Boolean);
  const groups = new Map();
  for (const task of tasks) {
    const meta = projectTemplateGroup(task);
    if (!groups.has(meta.key)) groups.set(meta.key, { ...meta, tasks: [], effortHours: 0, reviewCount: 0 });
    const group = groups.get(meta.key);
    group.tasks.push(projectTaskSummary(domain, task));
    group.effortHours = round1(group.effortHours + task.effortHours);
    if (isReviewTask(task)) group.reviewCount += 1;
  }
  return {
    project: {
      id: project.id,
      name: project.name,
      code: project.code,
      priority: tasks.map((task) => task.priority).sort((a, b) => (PROJECT_PRIORITY_ORDER[a] ?? 4) - (PROJECT_PRIORITY_ORDER[b] ?? 4))[0] ?? 'Normal',
      taskCount: tasks.length,
      effortHours: round1(sum(tasks.map((task) => task.effortHours))),
      dueFromLabel: tasks.length ? formatDate(tasks.map((task) => task.dueDate).sort((a, b) => a - b)[0]) : '—',
      dueToLabel: tasks.length ? formatDate(tasks.map((task) => task.dueDate).sort((a, b) => a - b).slice(-1)[0], true) : '—',
      reviewCount: tasks.filter(isReviewTask).length,
    },
    tasks: tasks.map((task) => projectTaskSummary(domain, task)),
    groups: [...groups.values()],
    testPlans: testPlans.filter((plan) => plan.projectId === projectId),
  };
}

function segmentsOverlap(plan, acceptedPlans) {
  for (const segment of plan.segments) {
    for (const accepted of acceptedPlans) {
      for (const other of accepted.segments) {
        if (segment.day !== other.day) continue;
        const sharesResource =
          (segment.personId && segment.personId === other.personId) ||
          (segment.equipmentId && segment.equipmentId === other.equipmentId) ||
          (segment.spaceId && segment.spaceId === other.spaceId);
        if (sharesResource && segment.startMin < other.endMin && other.startMin < segment.endMin) {
          return other;
        }
      }
    }
  }
  return null;
}

function applyPlanToContext(ctx, plan) {
  for (const segment of plan.segments) {
    const personKey = `${segment.personId}|${segment.day}`;
    ctx.loads.person.set(personKey, round1((ctx.loads.person.get(personKey) ?? 0) + segment.hours));
    const resourceKey = `${segment.equipmentId}|${segment.day}`;
    ctx.loads.resource.set(resourceKey, round1((ctx.loads.resource.get(resourceKey) ?? 0) + segment.hours));
    if (segment.spaceId) {
      const spaceKey = `${segment.spaceId}|${segment.day}`;
      ctx.loads.resource.set(spaceKey, round1((ctx.loads.resource.get(spaceKey) ?? 0) + segment.hours));
    }
  }
}

/**
 * Schedule every task in one project/template group into a single test plan.
 * Tasks are sequenced by priority and due date; each accepted plan is folded
 * into the temporary calendar before the next task is solved, so the batch
 * respects resource conflicts instead of stacking independent plans.
 * @param {ReturnType<typeof createEngineContext>} ctx
 * @param {string} projectId
 * @param {string|null} templateId - template group key, or null for all project tasks
 * @param {{actor?: string, count?: number}} [options]
 */
export function generateTestPlan(ctx, projectId, templateId, options = {}) {
  const project = ctx.domain.projects.find((item) => item.id === projectId);
  if (!project) return { found: false, projectId };
  const allTasks = project.taskIds.map((id) => ctx.domain.taskById.get(id)).filter(Boolean);
  const selected = allTasks
    .filter((task) => (templateId ? (task.templateId ?? 'custom') === templateId : true))
    .sort((a, b) => (PROJECT_PRIORITY_ORDER[a.priority] ?? 4) - (PROJECT_PRIORITY_ORDER[b.priority] ?? 4) || a.dueDate - b.dueDate);
  if (selected.length === 0) {
    return { found: true, projectId, testPlan: null, plans: [], diagnostics: [{ code: 'no_tasks', text: '该模板分组下没有任务' }] };
  }
  const batchCtx = {
    ...ctx,
    loads: {
      ...ctx.loads,
      person: new Map(ctx.loads.person),
      resource: new Map(ctx.loads.resource),
    },
  };
  const plans = [];
  const unscheduled = [];
  for (const task of selected) {
    let earliestStart = options.earliestStart;
    let plan = null;
    let diagnostics = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = generatePlans(batchCtx, task, { count: 1, ...options, earliestStart });
      plan = result.plans[0];
      diagnostics = result.diagnostics;
      if (!plan) break;
      const conflict = segmentsOverlap(plan, plans);
      if (!conflict) break;
      // The daily-hour model can place a new plan inside an earlier batch plan
      // that started later than 08:00. Retry from the day after the conflict.
      earliestStart = dateKey(addDays(parseInstant(`${conflict.day}T12:00:00+08:00`), 1));
      plan = null;
    }
    if (!plan) {
      unscheduled.push({ taskId: task.id, taskName: task.name, diagnostics });
      continue;
    }
    plans.push(plan);
    applyPlanToContext(batchCtx, plan);
  }
  const suffix = `${Date.now().toString(36).slice(-4).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  for (const plan of plans) plan.id = `${plan.id}-TP${suffix}`;
  const firstTask = selected[0];
  const groupKey = templateId ?? (selected.every((task) => (task.templateId ?? 'custom') === (firstTask.templateId ?? 'custom')) ? firstTask.templateId ?? 'custom' : 'all');
  const templateName = templateId
    ? selected[0].template?.name ?? '未匹配模板'
    : selected.every((task) => (task.templateId ?? 'custom') === (firstTask.templateId ?? 'custom'))
      ? selected[0].template?.name ?? '未匹配模板'
      : '项目全部任务';
  const methodCode = templateId ? selected[0].template?.methodCode ?? 'CUSTOM' : 'MULTI';
  const startAt = plans.length > 0 ? plans.map((plan) => parseInstant(plan.startAt)).sort((a, b) => a - b)[0] : null;
  const endAt = plans.length > 0 ? plans.map((plan) => parseInstant(plan.endAt)).sort((a, b) => b - a)[0] : null;
  const days = [...new Set(plans.flatMap((plan) => plan.segments.map((segment) => segment.day)))].sort();
  const taskById = ctx.domain.taskById;
  const testPlan = {
    id: `TP-${project.id}-${groupKey}-${suffix}`,
    projectId: project.id,
    projectName: project.name,
    templateId: templateId ?? (groupKey === 'all' ? null : firstTask.templateId ?? null),
    templateKey: groupKey,
    templateName,
    methodCode,
    taskIds: plans.map((plan) => plan.taskId),
    requestedTaskIds: selected.map((task) => task.id),
    plans,
    status: 'draft',
    createdAt: new Date().toISOString(),
    createdBy: options.actor ?? 'workspace',
    startAt: startAt?.toISOString() ?? null,
    endAt: endAt?.toISOString() ?? null,
    startLabel: startAt ? formatDateTime(startAt) : null,
    endLabel: endAt ? formatDateTime(endAt) : null,
    totalHours: round1(sum(plans.map((plan) => plan.totalHours))),
    summary: {
      taskCount: selected.length,
      scheduled: plans.length,
      unscheduled: unscheduled.length,
      late: plans.filter((plan) => parseInstant(plan.endAt) > taskById.get(plan.taskId).dueDate).length,
      review: selected.filter(isReviewTask).length,
    },
    unscheduled,
    timeline: {
      days: days.map((day) => ({ key: day, label: formatDate(`${day}T12:00:00+08:00`), weekday: dayLabel(`${day}T12:00:00+08:00`) })),
      rows: plans.map((plan) => ({
        taskId: plan.taskId,
        name: taskById.get(plan.taskId)?.name ?? plan.taskName,
        priority: taskById.get(plan.taskId)?.priority ?? 'Normal',
        planId: plan.id,
        segments: plan.segments,
      })),
    },
  };
  return { found: true, projectId, testPlan, plans, diagnostics: unscheduled };
}

const PLAN_STATUS_RANK = { confirmed: 0, feasible: 1, at_risk: 2, needs_review: 3, blocked: 4 };

/**
 * Build a multi-task resource schedule for one week from the active plans.
 * Only one plan per task is chosen (confirmed first, then score/recency), so
 * alternative plans are not drawn as simultaneous bookings.
 * @param {ReturnType<typeof createEngineContext>} ctx
 * @param {object[]} plans - active plans from MongoDB
 * @param {string} weekStart
 * @param {number} [weekCount]
 */
export function resourceSchedule(ctx, plans, weekStart, weekCount = 1) {
  const count = Math.max(1, Math.min(4, Number(weekCount) || 1));
  const start = startOfDay(weekStart ?? ctx.start);
  const days = Array.from({ length: count * 7 }, (_, index) => {
    const key = dateKey(addDays(start, index));
    return { key, label: formatDate(`${key}T12:00:00+08:00`), weekday: dayLabel(`${key}T12:00:00+08:00`) };
  });
  const dayKeys = new Set(days.map((day) => day.key));
  const chosen = new Map();
  for (const plan of plans) {
    if (!plan || plan.status === 'superseded' || !Array.isArray(plan.segments) || plan.segments.length === 0) continue;
    const current = chosen.get(plan.taskId);
    const rank = PLAN_STATUS_RANK[plan.status] ?? 5;
    const currentRank = current ? PLAN_STATUS_RANK[current.status] ?? 5 : Infinity;
    if (!current || rank < currentRank || (rank === currentRank && String(plan.generatedAt) > String(current.generatedAt))) {
      chosen.set(plan.taskId, plan);
    }
  }
  const resources = new Map();
  const tasks = new Map();
  const planSummaries = [];
  for (const plan of chosen.values()) {
    const task = ctx.domain.taskById.get(plan.taskId);
    const relevant = plan.segments.filter((segment) => dayKeys.has(segment.day));
    if (relevant.length === 0) continue;
    planSummaries.push({
      planId: plan.id,
      taskId: plan.taskId,
      taskName: task?.name ?? plan.taskName,
      priority: task?.priority ?? plan.priority,
      status: plan.status,
      statusLabel: plan.statusLabel,
      strategyLabel: plan.strategyLabel,
      score: plan.score,
      startLabel: plan.startLabel,
      endLabel: plan.endLabel,
      segmentCount: relevant.length,
    });
    tasks.set(plan.taskId, {
      id: plan.taskId,
      name: task?.name ?? plan.taskName,
      priority: task?.priority ?? plan.priority,
      planId: plan.id,
      status: plan.status,
      statusLabel: plan.statusLabel,
    });
    for (const segment of relevant) {
      const roles = [
        { id: segment.equipmentId, name: segment.equipmentName, kind: 'equipment', type: ctx.domain.equipmentById.get(segment.equipmentId)?.type ?? '设备' },
        { id: segment.personId, name: segment.personName, kind: 'person', type: ctx.domain.personById.get(segment.personId)?.team ?? '人员' },
        ...(segment.spaceId ? [{ id: segment.spaceId, name: segment.spaceName, kind: 'space', type: '空间' }] : []),
      ];
      for (const role of roles) {
        if (!role.id) continue;
        if (!resources.has(role.id)) {
          resources.set(role.id, { ...role, segments: [] });
        }
        resources.get(role.id).segments.push({
          taskId: plan.taskId,
          taskName: task?.name ?? plan.taskName,
          priority: task?.priority ?? plan.priority,
          planId: plan.id,
          strategyLabel: plan.strategyLabel,
          day: segment.day,
          start: segment.start,
          end: segment.end,
          hours: segment.hours,
          startMin: segment.startMin,
          endMin: segment.endMin,
        });
      }
    }
  }
  const kindOrder = { equipment: 0, person: 1, space: 2 };
  const resourceList = [...resources.values()].sort((a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) || a.name.localeCompare(b.name));
  const activeTaskIds = new Set(chosen.keys());
  const withoutPlanTasks = ctx.domain.tasks
    .filter((task) => !activeTaskIds.has(task.id))
    .map((task) => ({ id: task.id, name: task.name, priority: task.priority, dueLabel: formatDate(task.dueDate, true) }));
  const endKey = days[days.length - 1]?.key ?? dateKey(start);
  return {
    weekStart: dateKey(start),
    weekEnd: endKey,
    weekLabel: `${formatDate(`${dateKey(start)}T12:00:00+08:00`)}–${formatDate(`${endKey}T12:00:00+08:00`)}`,
    weekCount: count,
    days,
    resources: resourceList,
    tasks: [...tasks.values()].sort((a, b) => (PROJECT_PRIORITY_ORDER[a.priority] ?? 4) - (PROJECT_PRIORITY_ORDER[b.priority] ?? 4) || a.id.localeCompare(b.id)),
    plans: planSummaries,
    summary: {
      schedules: planSummaries.length,
      tasks: tasks.size,
      withPlan: chosen.size,
      withoutPlan: withoutPlanTasks.length,
      resources: resourceList.length,
      equipment: resourceList.filter((item) => item.kind === 'equipment').length,
      persons: resourceList.filter((item) => item.kind === 'person').length,
      spaces: resourceList.filter((item) => item.kind === 'space').length,
      segments: resourceList.reduce((total, item) => total + item.segments.length, 0),
    },
    withoutPlanTasks,
    note: '只显示未替代的已生成/已确认方案，每个任务取一个方案；没有方案的任务不在总览中。',
  };
}

export function buildOverview(domain, ctx, extra = {}) {
  const windowDays = 14;
  const loads = ctx.loads;
  const equipment = domain.equipment.map((item) => {
    let used = 0;
    for (const day of dayList(ctx.start, windowDays)) used += loadFor(loads.resource, item.id, day);
    const capacity = resourceCapacityHours(item) * windowDays;
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      status: item.status,
      calibrationDue: item.calibrationDue,
      utilization: capacity > 0 ? Math.round((used / capacity) * 100) : 0,
      used: round1(used),
    };
  });
  const totalUsed = sum(equipment.map((item) => item.used));
  for (const item of equipment) {
    item.loadShare = totalUsed > 0 ? Math.round((item.used / totalUsed) * 100) : 0;
    item.blocked = item.status !== 'Operational';
  }
  const persons = domain.persons.map((person) => {
    let used = 0;
    for (const day of dayList(ctx.start, windowDays)) used += loadFor(loads.person, person.id, day);
    return {
      id: person.id,
      name: person.name,
      team: person.team,
      used: round1(used),
      utilization: Math.round((used / (person.dailyCapacityHours * windowDays)) * 100),
    };
  });
  const totalPersonUsed = sum(persons.map((person) => person.used));
  for (const person of persons) person.loadShare = totalPersonUsed > 0 ? Math.round((person.used / totalPersonUsed) * 100) : 0;
  const loadRisk = domain.tasks
    .map((task) => {
      const daysLeft = Math.max(0, Math.ceil(diffHours(task.dueDate, ctx.now) / 24));
      const capacity = Math.max(1, daysLeft + 1) * 6;
      return { task, loadPct: Math.round((task.effortHours / capacity) * 100) };
    })
    .filter((entry) => entry.loadPct >= 65)
    .sort((a, b) => b.loadPct - a.loadPct);
  const riskTasks = [
    ...loadRisk.map((entry) => entry.task.id),
    ...domain.tasks.filter((task) => isReviewTask(task) && !loadRisk.some((entry) => entry.task.id === task.id)).map((task) => task.id),
  ];
  const alerts = [];
  for (const item of domain.equipment) {
    if (item.status !== 'Operational') {
      alerts.push({
        level: item.status === 'In Calibration' ? 'warn' : 'error',
        title: `${item.name} 当前${item.status}`,
        detail: `校准/维护到期：${item.calibrationDue ?? '—'}；相关任务需改用替代设备或人工审核。`,
        resourceId: item.id,
      });
    }
  }
  for (const task of domain.tasks) {
    if (isReviewTask(task)) {
      alerts.push({
        level: 'warn',
        title: `${task.name} 需方法审核`,
        detail: `${task.id} 为非标准方法，资源与资质组合需人工确认后才能提交。`,
        taskId: task.id,
      });
    }
  }
  const urgent = domain.tasks.filter((task) => task.priority === 'Urgent').length;
  const totalCapacity = sum(equipment.map((item) => item.used));
  return {
    clock: {
      now: ctx.now.toISOString(),
      dateLabel: formatDate(ctx.now, true),
      frozen: true,
      note: '演示时钟冻结在 2026-10-27 08:00',
    },
    stats: {
      totalTasks: domain.tasks.length,
      openTasks: domain.tasks.filter((task) => !/completed|closed/i.test(task.status)).length,
      urgentTasks: urgent,
      equipmentAvailable: domain.equipment.filter((item) => item.status === 'Operational').length,
      equipmentTotal: domain.equipment.length,
      spacesAvailable: domain.spaces.filter((item) => item.status === 'Available').length,
      riskTasks: riskTasks.length,
      reviewTasks: domain.tasks.filter(isReviewTask).length,
      equipmentUtilization: equipment.length > 0 ? Math.round((totalCapacity / (equipment.length * 8 * windowDays)) * 100) : 0,
      totalLoadHours: round1(totalUsed),
    },
    tasks: domain.tasks.map((task) => {
      const daysLeft = Math.ceil(diffHours(task.dueDate, ctx.now) / 24);
      return {
        id: task.id,
        name: task.name,
        projectName: task.projectName,
        priority: task.priority,
        dueDate: task.dueDate.toISOString(),
        dueLabel: formatDate(task.dueDate, true),
        daysLeft,
        effortHours: task.effortHours,
        status: task.status,
        review: isReviewTask(task),
        risk: riskTasks.includes(task.id) ? (isReviewTask(task) ? 'medium' : 'high') : 'low',
        spaceIds: task.requirements.spaceIds,
        equipmentIds: task.requirements.equipmentIds,
      };
    }),
    equipment,
    persons,
    alerts,
    riskTasks,
    timeline: buildTimeline(domain, ctx, 16),
    ...extra,
  };
}

export function resourcePage(domain, ctx) {
  const windowDays = 14;
  const equipment = domain.equipment.map((item) => {
    let used = 0;
    let peak = 0;
    const perDay = [];
    for (const day of dayList(ctx.start, windowDays)) {
      const load = loadFor(ctx.loads.resource, item.id, day);
      used += load;
      peak = Math.max(peak, load);
      perDay.push({ day, load: round1(load) });
    }
    const capacity = resourceCapacityHours(item) * windowDays;
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      kind: item.kind,
      location: item.location,
      capabilities: item.capabilities,
      status: item.status,
      calibrationDue: item.calibrationDue,
      workHours: `${minToTime(item.availableFrom)}-${minToTime(item.availableTo)}`,
      used: round1(used),
      capacity: round1(capacity),
      utilization: capacity > 0 ? Math.round((used / capacity) * 100) : 0,
      peak: round1(peak),
      perDay,
    };
  });
  const persons = domain.persons.map((person) => {
    let used = 0;
    let blocked = 0;
    const days = [];
    for (const day of dayList(ctx.start, windowDays)) {
      const taskLoad = loadFor(ctx.loads.person, person.id, day);
      const activity = loadFor(ctx.loads.activity, person.id, day);
      used += taskLoad;
      blocked += activity;
      days.push({ day, taskLoad: round1(taskLoad), blocked: round1(activity), capacity: person.dailyCapacityHours });
    }
    return {
      id: person.id,
      name: person.name,
      employmentType: person.employmentType,
      team: person.team,
      qualifications: person.qualifications,
      capacity: person.dailyCapacityHours,
      workHours: `${minToTime(person.workStart)}-${minToTime(person.workEnd)}`,
      status: person.status,
      used: round1(used),
      blocked: round1(blocked),
      utilization: Math.round((used / (person.dailyCapacityHours * windowDays)) * 100),
      days,
      activities: domain.activities
        .filter((activity) => activity.personId === person.id)
        .map((activity) => ({
          id: activity.id,
          type: activity.type,
          title: activity.title,
          start: activity.start.toISOString(),
          end: activity.end.toISOString(),
          impact: activity.impact,
          blockedHours: activity.blockedHours,
        })),
    };
  });
  const spaces = domain.spaces.map((item) => {
    let used = 0;
    for (const day of dayList(ctx.start, windowDays)) used += loadFor(ctx.loads.resource, item.id, day);
    const capacity = resourceCapacityHours(item) * windowDays;
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      location: item.location,
      status: item.status,
      used: round1(used),
      capacity: round1(capacity),
      utilization: capacity > 0 ? Math.round((used / capacity) * 100) : 0,
    };
  });
  return { windowDays, equipment, persons, spaces, days: dayList(ctx.start, windowDays) };
}

export function taskDetail(domain, ctx, taskId, plans = []) {
  const task = domain.taskById.get(taskId);
  if (!task) return null;
  const equipment = equipmentCandidatesForTask(domain, task);
  const persons = personCandidatesForTask(domain, task);
  const spaces = spaceCandidatesForTask(domain, task);
  const allocations = domain.allocations
    .filter((item) => item.taskId === task.id)
    .map((item) => ({ id: item.id, date: item.date, personId: item.personId, resourceId: item.resourceId, type: item.type, load: item.load }));
  const activities = domain.activities
    .filter((activity) => persons.some((entry) => entry.person.id === activity.personId))
    .map((activity) => ({
      id: activity.id,
      personId: activity.personId,
      type: activity.type,
      title: activity.title,
      start: activity.start.toISOString(),
      end: activity.end.toISOString(),
      impact: activity.impact,
      blockedHours: activity.blockedHours,
    }));
  const history = domain.history
    .filter((item) => !task.templateId || item.templateId === task.templateId)
    .map((item) => ({
      id: item.id,
      plannedMinutes: item.plannedMinutes,
      actualMinutes: item.actualMinutes,
      finalStatus: item.finalStatus,
      equipmentId: item.equipmentId,
      personId: item.personId,
      note: item.note,
    }));
  return {
    task: {
      id: task.id,
      name: task.name,
      method: task.method,
      projectId: task.projectId,
      projectName: task.projectName,
      projectCode: task.projectCode,
      testNo: task.testNo,
      priority: task.priority,
      status: task.status,
      requestedStart: task.requestedStart?.toISOString() ?? null,
      dueDate: task.dueDate.toISOString(),
      dueLabel: formatDate(task.dueDate, true),
      effortHours: task.effortHours,
      elapsedDays: task.elapsedDays,
      templateId: task.templateId,
      templateName: task.template?.name ?? null,
      qualifications: task.requirements.qualifications,
      equipmentType: task.requirements.equipmentType,
      equipmentIds: task.requirements.equipmentIds,
      spaceIds: task.requirements.spaceIds,
      prepMinutes: task.requirements.prepMinutes,
      review: isReviewTask(task),
    },
    candidates: {
      equipment: equipment.required.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        status: item.status,
        calibrationDue: item.calibrationDue,
        usable: equipmentUsableAt(item, dateKey(ctx.now), ctx.downtime),
        reasons: equipmentUsableAt(item, dateKey(ctx.now), ctx.downtime) ? [] : explainEquipmentReasons(ctx, item, task),
      })),
      alternatives: equipment.alternatives.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        calibrationDue: item.calibrationDue,
        usable: equipmentUsableAt(item, dateKey(ctx.now), ctx.downtime),
      })),
      persons: persons.map((entry) => ({
        id: entry.person.id,
        name: entry.person.name,
        team: entry.person.team,
        qualifications: entry.person.qualifications,
        matched: entry.matched,
        missing: entry.missing,
      })),
      spaces,
    },
    allocations,
    activities,
    history,
    plans,
    constraints: domain.constraints,
  };
}
