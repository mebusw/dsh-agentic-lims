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

/** Fallback policy when a domain was built without the chapter-14 upgrade layer. */
const DEFAULT_TASK_TYPE_RULE = {
  label: '测试规范（Test Spec）',
  exclusive: false,
  shareable: true,
  maxConcurrentTasks: 2,
  description: '允许按剩余容量共享设备。',
};

function taskTypeRule(task) {
  return task?.taskTypeRule ?? DEFAULT_TASK_TYPE_RULE;
}

function minutesOfDay(value) {
  const date = parseInstant(value);
  const shifted = new Date(date.getTime() + 8 * 3600000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

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
    config: domain.config ?? null,
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

/** Distinct other tasks already holding a resource on one day. */
function resourceDayTasks(ctx, resourceId, day, ignoreTaskId) {
  const ids = new Set();
  for (const allocation of ctx.domain.allocations) {
    if (allocation.resourceId !== resourceId || allocation.date !== day) continue;
    if (allocation.taskId === ignoreTaskId) continue;
    ids.add(allocation.taskId);
  }
  return ids;
}

/** People already holding the person on one day, excluding the task under test. */
function personDayTasks(ctx, personId, day, ignoreTaskId) {
  const ids = new Set();
  for (const allocation of ctx.domain.allocations) {
    if (allocation.personId !== personId || allocation.date !== day) continue;
    if (allocation.taskId === ignoreTaskId) continue;
    ids.add(allocation.taskId);
  }
  return ids;
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
  const policy = taskTypeRule(task);
  const sample = task.sample ?? null;
  const sampleReadyAt = sample?.readyAt ? parseInstant(sample.readyAt) : null;
  const sampleReadyDay = sampleReadyAt ? dateKey(sampleReadyAt) : null;
  // HC-108: actual testing never starts before the sample is on hand.
  const sampleBlocks = Boolean(sample?.blocked);
  const requestedEarliest = options.earliestStart ? startOfDay(options.earliestStart) : ctx.now;
  const earliest = sampleReadyAt && sampleReadyAt > requestedEarliest ? sampleReadyAt : requestedEarliest;
  const firstDay = dateKey(earliest);
  const dueKey = dateKey(task.dueDate);
  // Math.max over two Date objects returns a number, which parseInstant() cannot
  // read and silently falls back to DEMO_NOW. That capped the horizon at now+10
  // days, so anything further out was reported as "no capacity". Compare epoch ms.
  const horizonBase = new Date(Math.max(startOfDay(task.dueDate).getTime(), startOfDay(ctx.now).getTime()));
  const limitDay = dateKey(addDays(horizonBase, 10));
  const days = ctx.days.filter((day) => day >= firstDay && day <= limitDay);
  let lastDay = null;
  let sampleBlockedDays = 0;
  let policyBlockedDays = 0;

  for (const day of days) {
    // HC-107: weekends stay closed unless both the resource and the person allow it
    // (24h chambers / endurance benches run across weekends, people usually do not).
    if (isWeekend(day) && !(equipment.allowsWeekend && person.weekendAllowed)) continue;
    if (remaining <= 0) break;
    if (sampleBlocks) {
      sampleBlockedDays += 1;
      continue;
    }
    if (sampleReadyDay && day < sampleReadyDay) {
      sampleBlockedDays += 1;
      continue;
    }
    if (!equipmentUsableAt(equipment, day, ctx.downtime)) continue;
    const capacity = freeCapacity(ctx, task, equipment, person, space, day);
    if (capacity.free <= 0.1) continue;
    if (capacity.startMin >= capacity.endMin) continue;

    // HC-008: the task type policy decides whether the resource may be shared.
    if (policy.exclusive) {
      const otherEquipment = resourceDayTasks(ctx, equipment.id, day, task.id);
      const otherPersons = personDayTasks(ctx, person.id, day, task.id);
      if (otherEquipment.size > 0 || otherPersons.size > 0) {
        policyBlockedDays += 1;
        continue;
      }
    } else if (policy.maxConcurrentTasks) {
      const others = resourceDayTasks(ctx, equipment.id, day, task.id);
      if (others.size >= policy.maxConcurrentTasks) {
        policyBlockedDays += 1;
        continue;
      }
    }

    let dayStart = capacity.startMin;
    // Starting on the sample-ready day must also start after the arrival time.
    if (sampleReadyAt && day === sampleReadyDay) {
      dayStart = Math.max(dayStart, minutesOfDay(sampleReadyAt));
    }
    let dayEnd = capacity.endMin;
    if (options.avoidFridayAfternoon && dayLabel(`${day}T12:00:00+08:00`) === '周五') {
      dayEnd = Math.min(dayEnd, 12 * 60);
    }
    if (dayStart >= dayEnd) continue;
    const available = Math.min(remaining, capacity.free, (dayEnd - dayStart) / 60);
    if (available <= 0.1) continue;
    const hours = round1(available);
    const startMin = Math.round(dayStart);
    const endMin = Math.round(dayStart + hours * 60);
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
  const personMatch = personMatches(person, task.requirements.qualifications, ctx.domain.competencyById);
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
    constraintId: 'HC-103',
    type: 'Hard',
    name: '标准与设备能力匹配',
    result: capabilityOk ? 'pass' : 'fail',
    explanation: capabilityOk
      ? `${equipment.name}（${equipment.type}）满足任务要求`
      : `${equipment.name} 的类型/能力不满足 ${task.requirements.equipmentType}`,
  });
  evaluations.push({
    constraintId: 'HC-104',
    type: 'Hard',
    name: '能力项（Competency）',
    result: personMatch.qualified ? 'pass' : isReviewTask(task) ? 'warn' : 'fail',
    explanation: personMatch.qualified
      ? `${person.name} 具备能力项 ${(task.requirements.qualificationLabels ?? task.requirements.qualifications).join('、')}`
      : task.competencyCheck === 'OFF'
        ? `${person.name} 缺 ${(personMatch.missingLabels ?? personMatch.missing).join('、')}，但该 SPEC 关闭了能力校验（competency_check=OFF），仅提示`
        : `${person.name} 缺少能力项 ${(personMatch.missingLabels ?? personMatch.missing).join('、')}${isReviewTask(task) ? '；非标准方法允许人工复核' : ''}`,
  });
  evaluations.push({
    constraintId: 'HC-105',
    type: 'Hard',
    name: '设备状态与校准',
    result: calibrationOk ? 'pass' : 'fail',
    explanation: calibrationOk
      ? `${equipment.name} 在计划期间可用${equipment.calibrationDue ? `，校准有效期至 ${equipment.calibrationDue}` : ''}`
      : `${equipment.name} 状态为 ${equipment.status}，或校准在计划期内到期`,
  });
  evaluations.push({
    constraintId: 'HC-106',
    type: 'Hard',
    name: '资源不重复占用',
    result: capacityOk ? 'pass' : 'fail',
    explanation: capacityOk
      ? `已按每日剩余容量错峰安排，覆盖 ${planDays.length} 个工作日`
      : policyBlockedDays > 0
        ? '预约模式（Reservation Mode）排除了部分日期，剩余窗口内没有足够容量（见 HC-112）'
        : '在可执行窗口内无法找到足够的连续容量',
  });
  evaluations.push({
    constraintId: 'HC-107',
    type: 'Hard',
    name: '日历规则',
    result: calendarOk ? 'pass' : 'fail',
    explanation: calendarOk
      ? '所有时段均落在人员、设备与空间的工作时间内'
      : '存在超出工作时间的时段',
  });
  evaluations.push({
    constraintId: 'HC-111',
    type: 'Hard',
    name: '前处理工位',
    result: spaceOk ? 'pass' : 'fail',
    explanation: spaceOk
      ? space
        ? `前处理空间 ${space.name} 已预留`
        : '任务不需要前处理空间'
      : '任务要求前处理空间，但未找到可用空间',
  });

  // HC-108 — sample readiness is a first-class scheduling input.
  const sampleOk = Boolean(sample) ? !sample.blocks : true;
  const sampleExplained = sample
    ? sample.readyAt
      ? `${sample.statusLabel}${sample.actualInStockAt ? `（实际 ${formatDateTime(sample.actualInStockAt)}）` : `（预计 ${formatDateTime(sample.readyAt)}）`}，测试不早于样品到位时间`
      : `${sample.statusLabel}，但没有可用的到位时间`
    : '未登记样品信息，按可执行处理（需 TL 确认）';
  evaluations.push({
    constraintId: 'HC-108',
    ruleId: 'SAMPLE-READY',
    ruleVersion: ctx.config?.ruleVersion ?? 'LIMS-RULES-2026.10.29',
    type: 'Hard',
    name: '样品到位',
    result: !sample ? 'warn' : sampleOk ? (sample.partial ? 'warn' : 'pass') : 'fail',
    explanation: sample
      ? sampleOk
        ? `${sampleExplained}${sample.partial ? '；部分到样，是否允许分批测试待确认' : ''}`
        : `${sampleExplained}；样品未到位前不得开始实际测试`
      : '未登记样品信息，原型按可执行处理，需 TL 确认。',
    evidence: sample ? { status: sample.status, readyAt: sample.readyAt, source: sample.source, confirmed: sample.confirmed } : null,
  });

  // HC-008 — Task Type reservation policy (chapter 14.10).
  const policyOk = policyBlockedDays === 0 || feasible;
  evaluations.push({
    constraintId: 'HC-112',
    ruleId: `RESERVATION-${String(task.reservationMode ?? task.taskType ?? 'default').toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
    ruleVersion: ctx.config?.policyVersion ?? 'LAB-POLICY-2026.10.28',
    type: 'Hard',
    name: '预约模式（Reservation Mode）',
    result: policyOk ? 'pass' : 'fail',
    explanation: policyOk
      ? policy.exclusive
        ? `${policy.label ?? task.taskType}：设备与人员整日独占，${equipment.name} 在计划日没有其他任务占用`
        : `${policy.label ?? task.taskType}：允许按剩余容量共享${policy.maxConcurrentTasks ? `，同日上限 ${policy.maxConcurrentTasks} 个任务` : ''}`
      : policy.exclusive
        ? `${policy.label ?? task.taskType}：要求整日独占，但 ${equipment.name} 在可执行窗口内已有其他任务，找不到可独占工作日`
        : `${policy.label ?? task.taskType}：同日任务数已达上限 ${policy.maxConcurrentTasks ?? '—'} 个，无法再共享 ${equipment.name}`,
    evidence: {
      reservationMode: task.reservationMode ?? task.taskType ?? null,
      exclusive: Boolean(policy.exclusive),
      maxConcurrentTasks: policy.maxConcurrentTasks ?? null,
      blockedDays: policyBlockedDays,
      source: task.taskTypeSource ?? 'derived',
      confirmed: task.taskTypeConfirmed === true,
    },
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
  if (!policyOk) {
    evaluations.push({
      constraintId: 'CL-001',
      type: 'Hard',
      name: '预约模式冲突',
      result: 'fail',
      explanation: `预约模式不允许与 ${equipment.name} 上的其他活动共享，且窗口内找不到独占工作日`,
    });
  }
  if (sampleBlocks) {
    evaluations.push({
      constraintId: 'CL-002',
      type: 'Hard',
      name: '样品未到位',
      result: 'fail',
      explanation: '样品没有到位时间，无法判断可开始日期；请先补充样品状态',
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
    taskType: task.taskType ?? null,
    taskTypeLabel: task.taskTypeLabel ?? policy.label ?? null,
    reservation: {
      mode: policy.exclusive ? 'exclusive' : policy.shareable ? 'shared' : 'unknown',
      label: policy.exclusive ? '设备与人员独占' : `共享（同日上限 ${policy.maxConcurrentTasks ?? '—'} 个任务）`,
      policyId: task.taskType ?? 'default',
      confirmed: task.taskTypeConfirmed === true,
    },
    sample: sample
      ? {
          status: sample.status,
          statusLabel: sample.statusLabel,
          readyAt: sample.readyAt,
          confirmed: sample.confirmed,
          source: sample.source,
          note: sample.note,
        }
      : null,
    ruleVersion: ctx.config?.ruleVersion ?? null,
    policyVersion: ctx.config?.policyVersion ?? null,
    inputSnapshot: {
      taskType: task.taskType ?? null,
      sampleStatus: sample?.status ?? 'Unknown',
      sampleReadyAt: sample?.readyAt ?? null,
      sampleConfirmed: sample?.confirmed ?? false,
      dueDate: dateKey(task.dueDate),
      ruleVersion: ctx.config?.ruleVersion ?? null,
      policyVersion: ctx.config?.policyVersion ?? null,
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
      '原型冻结演示时钟为 2026-10-30 08:00，周末不排程。',
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

  const shortlist = picks.slice(0, count);
  const bestScore = shortlist.reduce((best, plan) => Math.max(best, plan.score ?? 0), -1);
  const bestIndex = shortlist.findIndex((plan) => (plan.score ?? 0) === bestScore);
  const selected = shortlist.map((plan, index) => ({
    ...plan,
    id: `PLAN-${task.id}-${index + 1}`,
    optionLabel: String.fromCharCode(65 + index),
    // The decision zone highlights one option, so an all-"需审核" shortlist is
    // still actionable instead of looking like a wall of blockers.
    recommended: index === bestIndex,
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

/** Copy a context so a what-if run cannot mutate the caller's calendars. */
function cloneContext(ctx) {
  return {
    ...ctx,
    downtime: new Set(ctx.downtime),
    loads: {
      ...ctx.loads,
      person: new Map(ctx.loads.person),
      resource: new Map(ctx.loads.resource),
      activity: new Map(ctx.loads.activity),
    },
    ownPerson: new Map(ctx.ownPerson),
    ownResource: new Map(ctx.ownResource),
  };
}

/** Drop one task's existing allocations, e.g. before applying its new plan. */
function subtractTaskAllocations(ctx, taskId) {
  for (const allocation of ctx.domain.allocations) {
    if (allocation.taskId !== taskId) continue;
    if (allocation.personId) {
      const key = `${allocation.personId}|${allocation.date}`;
      const next = (ctx.loads.person.get(key) ?? 0) - allocation.load;
      ctx.loads.person.set(key, round1(Math.max(0, next)));
    }
    if (allocation.resourceId) {
      const key = `${allocation.resourceId}|${allocation.date}`;
      const next = (ctx.loads.resource.get(key) ?? 0) - allocation.load;
      ctx.loads.resource.set(key, round1(Math.max(0, next)));
    }
  }
}

function windowFromBefore(before) {
  return {
    startAt: before.startAt,
    endAt: before.endAt,
    startLabel: before.startLabel,
    endLabel: before.endLabel,
    dayCount: before.dayCount,
    segments: before.segments,
  };
}

function windowFromPlan(plan) {
  if (!plan) return null;
  return {
    startAt: plan.startAt,
    endAt: plan.endAt,
    startLabel: plan.startLabel,
    endLabel: plan.endLabel,
    dayCount: plan.segments?.length ?? 0,
    score: plan.score,
    status: plan.status,
    statusLabel: plan.statusLabel,
    resources: plan.resources,
    segments: plan.segments,
    risks: plan.risks,
  };
}

const CHANGE_LABELS = {
  sample_delay: '样品到位时间变更',
  due_date: '交期变更',
  priority: '优先级变更',
  plan_revision: '排程条件变更',
};

function changeValueLabel(type, value) {
  if (!value) return null;
  if (type === 'priority') return String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  return formatDateTime(value);
}

/**
 * Impact analysis for one change event (chapter 14.7 / 14.8).
 *
 * The function is pure: the caller applies the change to MongoDB first, reloads
 * the domain, then hands both contexts here. It returns the direct effect on the
 * changed task plus up to three indirectly affected tasks that share the same
 * equipment or person, each re-planned against the post-change calendar with the
 * new target plan already laid down.
 *
 * @param {ReturnType<typeof createEngineContext>} beforeCtx
 * @param {ReturnType<typeof createEngineContext>} afterCtx
 * @param {{type: string, taskId: string, reason?: string, from?: string, to?: string, field?: string}} change
 */
export function analyzeChange(beforeCtx, afterCtx, change) {
  const taskBefore = beforeCtx.domain.taskById.get(change.taskId);
  const taskAfter = afterCtx.domain.taskById.get(change.taskId);
  if (!taskBefore || !taskAfter) {
    return { found: false, taskId: change.taskId, diagnostics: [{ code: 'task_not_found', text: `找不到任务 ${change.taskId}` }] };
  }

  const baseline = buildTaskBefore(beforeCtx, taskBefore);
  // A task created from a draft has no allocations yet; fall back to the plan the
  // old context would have produced so the delta still has a real baseline.
  const beforePlan = baseline.segments.length === 0 ? generatePlans(beforeCtx, taskBefore, { count: 1 }).plans[0] ?? null : null;
  const beforeWindow = beforePlan ? windowFromPlan(beforePlan) : windowFromBefore(baseline);
  const afterResult = generatePlans(afterCtx, taskAfter, { count: 3 });
  const afterPlan = afterResult.plans[0] ?? null;
  const beforeEnd = beforeWindow.endAt ? parseInstant(beforeWindow.endAt) : null;
  const afterEnd = afterPlan ? parseInstant(afterPlan.endAt) : null;
  const directDeltaHours = afterEnd && beforeEnd ? round1(diffHours(afterEnd, beforeEnd)) : null;
  const directLate = afterEnd ? afterEnd > taskAfter.dueDate : null;

  const direct = {
    taskId: taskAfter.id,
    taskName: taskAfter.name,
    kind: 'direct',
    relation: '变更对象',
    before: beforeWindow,
    after: windowFromPlan(afterPlan),
    deltaHours: directDeltaHours,
    late: directLate,
    severity: !afterPlan ? 'blocked' : directLate ? 'late' : directDeltaHours > 0 ? 'delayed' : 'ok',
    reason: !afterPlan
      ? afterResult.diagnostics.map((item) => item.text).join('；') || '变更后没有可行方案'
      : directLate
        ? `变更后预计完成 ${afterPlan.endLabel}，晚于交期 ${formatDate(taskAfter.dueDate, true)}`
        : directDeltaHours > 0
          ? `变更后完成时间推迟 ${round1(directDeltaHours)} 小时`
          : `变更后完成时间提前 ${round1(Math.abs(directDeltaHours ?? 0))} 小时`,
  };

  const targetEquipment = afterPlan?.resources?.equipment?.id ?? null;
  const targetEquipmentName = afterPlan?.resources?.equipment?.name ?? null;
  const targetPerson = afterPlan?.resources?.person?.id ?? null;
  const targetPersonName = afterPlan?.resources?.person?.name ?? null;
  const targetDays = new Set((afterPlan?.segments ?? []).map((segment) => segment.day));

  const relatedIds = unique(
    afterCtx.domain.allocations
      .filter(
        (allocation) =>
          allocation.taskId !== taskAfter.id &&
          ((targetEquipment && allocation.resourceId === targetEquipment) ||
            (targetPerson && allocation.personId === targetPerson)),
      )
      .filter((allocation) => allocation.date >= dateKey(afterCtx.now))
      .map((allocation) => allocation.taskId),
  );

  const cascadeCtx = cloneContext(afterCtx);
  subtractTaskAllocations(cascadeCtx, taskAfter.id);
  if (afterPlan) applyPlanToContext(cascadeCtx, afterPlan);

  const indirect = [];
  for (const taskId of relatedIds.slice(0, 3)) {
    const task = afterCtx.domain.taskById.get(taskId);
    if (!task) continue;
    const beforeWindow = buildTaskBefore(beforeCtx, task);
    const result = generatePlans(cascadeCtx, task, { count: 1 });
    const plan = result.plans[0] ?? null;
    const previousEnd = beforeWindow.endAt ? parseInstant(beforeWindow.endAt) : null;
    const nextEnd = plan ? parseInstant(plan.endAt) : null;
    const deltaHours = nextEnd && previousEnd ? round1(diffHours(nextEnd, previousEnd)) : null;
    const lateAfter = nextEnd ? nextEnd > task.dueDate : null;
    const sharesEquipment = targetEquipment && afterCtx.domain.allocations.some((item) => item.taskId === taskId && item.resourceId === targetEquipment);
    const sharesPerson = targetPerson && afterCtx.domain.allocations.some((item) => item.taskId === taskId && item.personId === targetPerson);
    indirect.push({
      taskId,
      taskName: task.name,
      kind: 'indirect',
      relation: [sharesEquipment ? `共用设备 ${targetEquipmentName}` : null, sharesPerson ? `共用人员 ${targetPersonName}` : null]
        .filter(Boolean)
        .join('、'),
      before: windowFromBefore(beforeWindow),
      after: windowFromPlan(plan),
      deltaHours,
      late: lateAfter,
      severity: !plan ? 'blocked' : lateAfter ? 'late' : deltaHours > 0 ? 'delayed' : 'ok',
      reason: !plan
        ? '重排后找不到可用容量，需要人工决策'
        : lateAfter
          ? `重排后完成 ${plan.endLabel}，晚于交期 ${formatDate(task.dueDate, true)}`
          : deltaHours > 0
            ? `因为共享资源被重新占用，完成时间推迟 ${round1(deltaHours)} 小时`
            : `共享资源仍有余量，计划基本不受影响（${plan.segments.length} 个工作日）`,
      targetOverlapDays: [...targetDays].filter((day) => plan?.segments?.some((segment) => segment.day === day)).length,
    });
  }

  const summary = {
    affected: 1 + indirect.length,
    direct: 1,
    indirect: indirect.length,
    delayed: [direct, ...indirect].filter((entry) => entry.severity === 'delayed').length,
    late: [direct, ...indirect].filter((entry) => entry.severity === 'late').length,
    blocked: [direct, ...indirect].filter((entry) => entry.severity === 'blocked').length,
  };

  const recommendations = [];
  if (direct.severity === 'blocked') {
    recommendations.push('变更后没有可行方案：先补齐样品/资质信息，或调整交期，再重新运行引擎。');
  } else if (direct.severity === 'late') {
    recommendations.push('变更对象会晚于交期：可考虑替代设备、拆分任务或提高优先级后重排。');
  }
  if (indirect.some((entry) => entry.severity === 'blocked' || entry.severity === 'late')) {
    recommendations.push('至少一个共享资源的任务会被推迟或阻塞，确认前应先为整批任务生成测试计划，避免只看单个任务。');
  }
  if (indirect.length > 0) {
    recommendations.push('受影响任务只是引擎推算的连锁影响；确认前请用 lims_generate_test_plan 或 lims_generate_plans 复核。');
  }
  if (recommendations.length === 0) {
    recommendations.push('当前变更未发现连带延期；仍建议在确认前重新校验资源状态。');
  }

  return {
    found: true,
    change: {
      id: change.id ?? null,
      type: change.type,
      typeLabel: CHANGE_LABELS[change.type] ?? change.type,
      field: change.field ?? null,
      from: change.from ?? null,
      to: change.to ?? null,
      fromLabel: changeValueLabel(change.type, change.from),
      toLabel: changeValueLabel(change.type, change.to),
      reason: change.reason ?? '',
      at: new Date().toISOString(),
      task: {
        id: taskAfter.id,
        name: taskAfter.name,
        projectId: taskAfter.projectId,
        projectName: taskAfter.projectName,
        priority: taskAfter.priority,
        dueLabel: formatDate(taskAfter.dueDate, true),
        effortHours: taskAfter.effortHours,
        taskType: taskAfter.taskType,
        sample: afterCtx.domain.taskById.get(taskAfter.id)?.sample ?? null,
        orderIds: taskAfter.orderIds ?? [],
      },
      ruleVersion: afterCtx.config?.ruleVersion ?? null,
      policyVersion: afterCtx.config?.policyVersion ?? null,
    },
    direct,
    indirect,
    summary,
    recommendations,
    candidatePlan: afterPlan
      ? {
          id: afterPlan.id,
          strategyLabel: afterPlan.strategyLabel,
          score: afterPlan.score,
          status: afterPlan.status,
          statusLabel: afterPlan.statusLabel,
          startLabel: afterPlan.startLabel,
          endLabel: afterPlan.endLabel,
          resources: afterPlan.resources,
          segments: afterPlan.segments,
          risks: afterPlan.risks,
          evaluations: afterPlan.evaluations,
          sample: afterPlan.sample,
          reservation: afterPlan.reservation,
        }
      : null,
    diagnostics: afterResult.diagnostics,
    generatedAt: new Date().toISOString(),
  };
}

function diagnoseInfeasible(ctx, task, equipment, persons) {
  const diagnostics = [];
  if (equipment.required.length === 0) {
    diagnostics.push({ code: 'no_equipment_requirement', text: '任务没有指定设备，且无法从方法推导设备类型' });
  }
  if (persons.length === 0) {
    diagnostics.push({
      code: 'no_qualified_person',
      text: `没有同站点人员同时具备 ${(task.requirements.qualificationLabels ?? task.requirements.qualifications).join('、') || '所需能力项'}（HC-104 / HC-110）`,
    });
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
  if (task.sample?.blocked) {
    diagnostics.push({
      code: 'sample_missing',
      text: '样品未到位且没有可用的到位时间；请先补充 sample_status，排程不能早于实际/预计到位时间（HC-108）',
    });
  }
  if (task.taskTypeRule?.exclusive) {
    diagnostics.push({
      code: 'prebook_conflict',
      text: `Task Type「${task.taskTypeLabel ?? task.taskType}」要求设备与人员整日独占，可执行窗口内没有完全空闲的工作日（HC-008）`,
    });
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
  const sampleLate = domain.tasks.filter(
    (task) => task.sample?.readyAt && parseInstant(task.sample.readyAt) > task.dueDate,
  );
  const riskTasks = [
    ...loadRisk.map((entry) => entry.task.id),
    ...sampleLate.map((task) => task.id),
    ...domain.tasks.filter((task) => isReviewTask(task) && !loadRisk.some((entry) => entry.task.id === task.id) && !sampleLate.includes(task)).map((task) => task.id),
  ];
  riskTasks.splice(0, riskTasks.length, ...unique(riskTasks));
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
    if (task.sample && task.sample.status !== 'In stock') {
      alerts.push({
        level: task.sample.status === 'Not in stock' ? 'warn' : 'warn',
        title: `${task.name} ${task.sample.statusLabel}`,
        detail: `${task.id} · ${task.sample.readyAt ? `到位时间 ${formatDateTime(task.sample.readyAt)}` : '没有到位时间'}；HC-108 不允许在样品到位前开始实际测试。`,
        taskId: task.id,
      });
    }
  }
  const specsAwaiting = domain.specs.filter((spec) => spec.phase === 'request');
  if (specsAwaiting.length > 0) {
    alerts.push({
      level: 'warn',
      title: `${specsAwaiting.length} 个 SPEC 未通过审批，不可排程`,
      detail: `${specsAwaiting.slice(0, 3).map((spec) => `${spec.id}（${spec.statusLabel}）`).join('、')}${specsAwaiting.length > 3 ? ' 等' : ''}；HC-101 要求状态进入 Approved 之后才进入排程池。`,
    });
  }
  const urgent = domain.tasks.filter((task) => task.priority === 'Urgent').length;
  const totalCapacity = sum(equipment.map((item) => item.used));
  return {
    clock: {
      now: ctx.now.toISOString(),
      dateLabel: formatDate(ctx.now, true),
      frozen: true,
      note: '演示时钟冻结在 2026-10-30 08:00',
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
      sampleNotReady: domain.tasks.filter((task) => task.sample && task.sample.status !== 'In stock').length,
      equipmentUtilization: equipment.length > 0 ? Math.round((totalCapacity / (equipment.length * 8 * windowDays)) * 100) : 0,
      totalLoadHours: round1(totalUsed),
      specTotal: domain.specs.length,
      specSchedulable: domain.specs.filter((spec) => spec.schedulable && spec.windowEnd).length,
      specAwaitingApproval: specsAwaiting.length,
      specNotSchedulable: domain.specs.filter((spec) => !(spec.schedulable && spec.windowEnd)).length,
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
        risk: riskTasks.includes(task.id) ? (isReviewTask(task) || task.sample?.partial ? 'medium' : 'high') : 'low',
        spaceIds: task.requirements.spaceIds,
        equipmentIds: task.requirements.equipmentIds,
        taskType: task.taskType ?? null,
        taskTypeLabel: task.taskTypeLabel ?? null,
        reservationMode: task.taskTypeRule?.exclusive ? 'exclusive' : 'shared',
        sample: task.sample ?? null,
        orderIds: task.orderIds ?? [],
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
      activities: domain.personActivities
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
  const activities = domain.personActivities
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
      taskType: task.taskType ?? null,
      taskTypeLabel: task.taskTypeLabel ?? null,
      taskTypeReason: task.taskTypeReason ?? null,
      taskTypeConfirmed: task.taskTypeConfirmed === true,
      reservationMode: task.taskTypeRule?.exclusive ? 'exclusive' : task.taskTypeRule?.shareable ? 'shared' : 'unknown',
      reservationRule: task.taskTypeRule ?? null,
      sample: task.sample ?? null,
      orderIds: task.orderIds ?? [],
      specIds: task.specIds ?? [],
      overriddenFields: task.overriddenFields ?? [],
      ruleVersion: ctx.config?.ruleVersion ?? null,
      policyVersion: ctx.config?.policyVersion ?? null,
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
