/**
 * Weekly planning grid.
 *
 * The customer's `Planning` sheet is a **week bucket**, not an hour timeline:
 * one line per activity with `Plan No. / LIMS No. / Priority / Sequence /
 * Workload / Week / Status / Event date`, plus 52 week columns per year.
 *
 * This module projects the prototype's plans and existing bookings onto that
 * shape. It stays read-only and never invents a column the customer's export
 * does not have: `PVP No.`, `Sample No.` and `A/& SMPL` are reported as
 * `fillable: false` with the reason.
 */
import { addDays, dateKey, formatDate, parseInstant, round1, startOfDay } from './util.js';

const PLAN_STATUS_RANK = { confirmed: 0, feasible: 1, at_risk: 2, needs_review: 3, blocked: 4 };

/** ISO-8601 week number (week 1 = the week containing Jan 4th). */
export function isoWeek(key) {
  const date = new Date(`${key}T00:00:00Z`);
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() + 3 - day); // Thursday of this week
  const year = date.getUTCFullYear();
  const week1 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round((date - week1) / 86400000 / 7);
  return { year, week };
}

/** Monday of the week containing `key` (customer sheets are Monday-based). */
export function mondayOf(key) {
  const date = new Date(`${key}T00:00:00Z`);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

function weekWindow(weekStart, weeks) {
  const start = mondayOf(weekStart);
  return Array.from({ length: weeks }, (_, index) => {
    const first = dateKey(addDays(parseInstant(`${start}T00:00:00+08:00`), index * 7));
    const last = dateKey(addDays(parseInstant(`${first}T00:00:00+08:00`), 6));
    const info = isoWeek(first);
    return {
      index,
      key: first,
      week: info.week,
      year: info.year,
      startKey: first,
      endKey: last,
      label: `W${String(info.week).padStart(2, '0')}`,
      rangeLabel: `${formatDate(`${first}T12:00:00+08:00`)}–${formatDate(`${last}T12:00:00+08:00`)}`,
    };
  });
}

function pickBestPlanPerTask(plans) {
  const chosen = new Map();
  for (const plan of plans ?? []) {
    if (!plan || plan.status === 'superseded') continue;
    if (!Array.isArray(plan.segments) || plan.segments.length === 0) continue;
    const current = chosen.get(plan.taskId);
    const rank = PLAN_STATUS_RANK[plan.status] ?? 5;
    const currentRank = current ? PLAN_STATUS_RANK[current.status] ?? 5 : Infinity;
    if (!current || rank < currentRank || (rank === currentRank && String(plan.generatedAt) > String(current.generatedAt))) {
      chosen.set(plan.taskId, plan);
    }
  }
  return chosen;
}

const STATUS_LABEL = {
  confirmed: '已确认',
  feasible: '候选（可行）',
  at_risk: '候选（有风险）',
  needs_review: '候选（需审核）',
  blocked: '候选（不可行）',
  'Pre-booked': '已预占',
  Finalized: '计划已定稿',
  'In progress': '执行中',
  Completed: '已完成',
};

const SUB_STATUS = {
  Prebook: 'ST',
  Subcontracted: 'ST',
};

/**
 * @param {object} domain
 * @param {object} ctx - engine context (frozen clock)
 * @param {{weekStart?: string, weeks?: number, site?: string, plans?: object[]}} options
 */
export function buildWeekPlan(domain, ctx, options = {}) {
  const weeks = Math.max(1, Math.min(12, Number(options.weeks) || 6));
  const weekStart = mondayOf(options.weekStart ? dateKey(options.weekStart) : dateKey(ctx.now));
  const window = weekWindow(weekStart, weeks);
  const windowKeys = new Set(window.map((week) => week.key));
  const weekIndexByDay = new Map();
  for (const week of window) {
    let cursor = parseInstant(`${week.startKey}T00:00:00+08:00`);
    for (let offset = 0; offset < 7; offset += 1) {
      weekIndexByDay.set(dateKey(cursor), week.index);
      cursor = addDays(cursor, 1);
    }
  }

  const units = new Map();
  const ensure = (activityId, seed) => {
    if (!units.has(activityId)) {
      units.set(activityId, {
        activityId,
        specId: seed.specId ?? null,
        planNo: seed.planNo ?? null,
        orderNo: seed.orderNo ?? null,
        project: seed.project ?? null,
        site: seed.site ?? null,
        test: seed.test ?? null,
        equipmentId: seed.equipmentId ?? null,
        equipmentName: seed.equipmentName ?? null,
        personId: seed.personId ?? null,
        personName: seed.personName ?? null,
        cubeId: seed.cubeId ?? null,
        priority: seed.priority ?? 'Normal',
        priorityCode: seed.priorityCode ?? null,
        status: seed.status ?? 'feasible',
        statusLabel: seed.statusLabel ?? null,
        reservationMode: seed.reservationMode ?? null,
        source: seed.source ?? 'plan',
        planId: seed.planId ?? null,
        workloadHours: 0,
        weeks: new Map(),
        firstDay: null,
        lastDay: null,
        segments: [],
      });
    }
    return units.get(activityId);
  };

  /* 1) candidate / confirmed plans ---------------------------------------- */
  const chosen = pickBestPlanPerTask(options.plans);
  for (const plan of chosen.values()) {
    const task = domain.taskById.get(plan.taskId) ?? null;
    const spec = task ? domain.specById.get(task.specId) ?? null : null;
    if (!task) continue;
    if (options.site && task.site !== options.site) continue;
    const unit = ensure(plan.taskId, {
      specId: task.specId,
      planNo: task.planNo,
      orderNo: spec?.orderNo ?? null,
      project: task.projectName,
      site: task.site,
      test: task.name,
      equipmentId: plan.resources?.equipment?.id ?? null,
      equipmentName: plan.resources?.equipment?.name ?? null,
      personId: plan.resources?.person?.id ?? null,
      personName: plan.resources?.person?.name ?? null,
      cubeId: plan.resources?.space?.id ?? null,
      priority: task.priority,
      priorityCode: task.priorityCode,
      status: plan.status,
      statusLabel: STATUS_LABEL[plan.status] ?? plan.status,
      reservationMode: task.reservationMode,
      source: 'plan',
      planId: plan.id,
    });
    unit.planId = plan.id;
    for (const segment of plan.segments) {
      const index = weekIndexByDay.get(segment.day);
      if (index === undefined) continue;
      unit.workloadHours = round1(unit.workloadHours + (segment.hours ?? 0));
      unit.weeks.set(index, round1((unit.weeks.get(index) ?? 0) + (segment.hours ?? 0)));
      unit.segments.push({ day: segment.day, start: segment.start, end: segment.end, hours: segment.hours });
      if (!unit.firstDay || segment.day < unit.firstDay) unit.firstDay = segment.day;
      if (!unit.lastDay || segment.day > unit.lastDay) unit.lastDay = segment.day;
    }
  }

  /* 2) existing bookings without a plan (Pre-booked / In progress / …) ---- */
  for (const activity of domain.specActivities) {
    if (!activity.start || units.has(activity.id)) continue;
    // `test_execution` rows are execution records, not bookings (same rule as the engine).
    if (activity.type === 'test_execution') continue;
    if (options.site && activity.site !== options.site) continue;
    const spec = domain.specById.get(activity.specId) ?? null;
    const task = domain.taskById.get(activity.id) ?? null;
    const dayKey = dateKey(activity.start);
    const index = weekIndexByDay.get(dayKey);
    if (index === undefined) continue;
    if (!task && !['Pre-booked', 'In progress', 'Completed', 'Finalized'].includes(spec?.status)) continue;
    const step = activity.step ?? null;
    const standardEffort = step ? round1(((step.testMinutes ?? 0) + (step.prepMinutes ?? 0)) / 60) : null;
    const hours = activity.effortHours ?? standardEffort ?? 0;
    const unit = ensure(activity.id, {
      specId: activity.specId,
      planNo: activity.planNo,
      orderNo: spec?.orderNo ?? null,
      project: spec?.project ?? null,
      site: activity.site,
      test: activity.name,
      equipmentId: activity.resourceId,
      equipmentName: activity.resource?.name ?? null,
      personId: activity.personId,
      personName: activity.person?.name ?? null,
      cubeId: activity.cubeId,
      priority: spec?.priority?.value ?? 'Normal',
      priorityCode: spec?.priority?.code ?? null,
      status: spec?.status ?? activity.status ?? 'feasible',
      statusLabel: STATUS_LABEL[spec?.status] ?? spec?.statusLabel ?? null,
      reservationMode: task?.reservationMode ?? (activity.type === 'subcontracted' ? 'Subcontracted' : null),
      source: 'booking',
    });
    unit.workloadHours = round1(unit.workloadHours + hours);
    unit.weeks.set(index, round1((unit.weeks.get(index) ?? 0) + hours));
    unit.segments.push({
      day: dayKey,
      start: activity.start ? dateKey(activity.start) !== dayKey ? null : undefined : undefined,
      end: undefined,
      hours,
    });
    unit.firstDay = dayKey;
    unit.lastDay = dateKey(activity.end ?? activity.start);
  }

  /* 3) sequence inside a week, per resource ------------------------------- */
  const rows = [...units.values()].map((unit) => {
    const weekNumbers = [...unit.weeks.keys()].sort((a, b) => a - b);
    const primary = weekNumbers[0] ?? null;
    return { ...unit, weekNumbers, primaryWeek: primary };
  });

  const byResourceWeek = new Map();
  for (const row of rows) {
    if (row.primaryWeek === null) continue;
    const key = `${row.primaryWeek}|${row.equipmentId ?? row.activityId}`;
    if (!byResourceWeek.has(key)) byResourceWeek.set(key, []);
    byResourceWeek.get(key).push(row);
  }
  for (const bucket of byResourceWeek.values()) {
    bucket.sort((first, second) => {
      const rank = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
      return (rank[first.priority] ?? 4) - (rank[second.priority] ?? 4) || String(first.firstDay).localeCompare(String(second.firstDay));
    });
    bucket.forEach((row, index) => {
      row.sequence = index + 1;
    });
  }

  const weekList = window.map((week) => ({
    ...week,
    hours: round1(rows.reduce((total, row) => total + (row.weeks.get(week.index) ?? 0), 0)),
    activities: rows.filter((row) => row.weeks.has(week.index)).length,
    overThreshold: false,
  }));
  const threshold = Number(domain.config?.labPolicy?.weekCapacityWarningHours) || 0;
  for (const week of weekList) {
    week.overThreshold = threshold > 0 && week.hours > threshold;
  }

  const grid = rows.map((row) => ({
    planNo: row.planNo,
    limsNo: row.specId,
    orderNo: row.orderNo,
    project: row.project,
    site: row.site,
    equipment: row.equipmentName,
    equipmentId: row.equipmentId,
    test: row.test,
    resource: row.equipmentId,
    who: row.personName,
    priority: row.priority,
    priorityCode: row.priorityCode,
    sequence: row.sequence ?? null,
    workload: row.workloadHours,
    week: row.primaryWeek !== null ? window[row.primaryWeek]?.week ?? null : null,
    weekLabel: row.primaryWeek !== null ? window[row.primaryWeek]?.label ?? null : null,
    status: row.status,
    statusLabel: row.statusLabel ?? STATUS_LABEL[row.status] ?? row.status,
    customerStatusCode: SUB_STATUS[row.reservationMode] ?? null,
    eventDate: row.firstDay,
    endDate: row.lastDay,
    activityId: row.activityId,
    planId: row.planId,
  }));

  const fillable = {
    order: { ok: grid.some((row) => Boolean(row.orderNo)), note: 'Order 列来自排程回填表，LIMS 导出没有' },
    project: { ok: grid.some((row) => Boolean(row.project)), note: '项目字段可为空（客户 2/50）' },
    planNo: { ok: grid.some((row) => Boolean(row.planNo)), note: 'PLAN 批次号' },
    limsNo: { ok: true, note: 'SPEC 号（SPEC… / SUBS…）' },
    equipment: { ok: true, note: '资源主数据的 EQPT 编码' },
    pvpNo: { ok: false, note: '客户主数据里没有 PVP No.，需确认含义' },
    sampleNo: { ok: false, note: '我们只有样品数量，没有样品编号' },
    sampleFlag: { ok: false, note: 'A/& SMPL 列含义待确认' },
    priority: { ok: grid.some((row) => Boolean(row.priorityCode)), note: '优先级来自排程表填写，值域待确认' },
    sequence: { ok: grid.every((row) => row.sequence !== null), note: '周内序号按优先级 + 日期推导' },
    test: { ok: true, note: '活动名沿用客户甘特口径' },
    resource: { ok: true, note: '设备' },
    who: { ok: grid.some((row) => Boolean(row.who)), note: '执行人；未分配时为空' },
    cube: { ok: grid.some((row) => row.activityId && domain.specActivities.find((item) => item.id === row.activityId)?.cubeId), note: 'Cube 列含义待确认（目前按前处理工位填）' },
    workload: { ok: true, note: '小时；客户 Workload 列恒 0' },
    week: { ok: true, note: 'ISO-8601 周号（客户模板周列含义待确认）' },
    status: { ok: Boolean(SUB_STATUS), note: '客户状态码 L/l、F/f、ST 疑为法语缩写，仅分包可映射为 ST' },
    eventDate: { ok: true, note: '计划首日' },
  };

  const rowsForJson = rows.map((row) => ({ ...row, limsNo: row.specId, weeks: Object.fromEntries(row.weeks) }));

  return {
    weekStart,
    weeks: weekList,
    rows: rowsForJson,
    grid,
    fillable,
    summary: {
      activities: rows.length,
      hours: round1(rows.reduce((total, row) => total + row.workloadHours, 0)),
      scheduled: rows.filter((row) => row.source === 'plan').length,
      booked: rows.filter((row) => row.source === 'booking').length,
      overThreshold: weekList.filter((week) => week.overThreshold).length,
      threshold,
      bySite: rows.reduce((acc, row) => {
        const key = row.site ?? '—';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    },
    notes: [
      '周号按 ISO-8601 计算（周一为一周起点）；客户模板的周列起止规则待确认。',
      '一行 = 一个规格活动；跨周的活动的工时按天分摊到对应周列。',
      'PVP No. / Sample No. / A& SMPL 三列没有数据来源，schema 里显式标了 fillable:false。',
    ],
    threshold,
    ruleVersion: domain.config?.ruleVersion ?? null,
  };
}

export { PLAN_STATUS_RANK };
