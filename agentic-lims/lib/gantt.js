/**
 * Four-layer Gantt for the customer's hierarchy:
 *
 *   Project → PLAN batch → SPEC → spec activity
 *
 * The customer's gantt export has exactly this indentation (`Project: …` →
 * `PLAN26AA1126-1` → `SPEC26AA4855-1` → `TD1&2- Salt mist`), so the page renders
 * the same tree instead of a flat resource list. It stays read-only: bars come
 * from candidate/confirmed plans first, then from booked activity windows.
 */
import { addDays, dateKey, dayLabel, formatDate, parseInstant, round1, startOfDay } from './util.js';
import { PLAN_STATUS_RANK, isoWeek } from './weekplan.js';

const STATUS_TONE = {
  confirmed: 'ok',
  feasible: 'brand',
  at_risk: 'warn',
  needs_review: 'warn',
  blocked: 'error',
  'Pre-booked': 'warn',
  Finalized: 'brand',
  'In progress': 'warn',
  Completed: 'idle',
  Cancelled: 'idle',
};

const STATUS_LABEL = {
  confirmed: '已确认',
  feasible: '候选（可行）',
  at_risk: '候选（有风险）',
  needs_review: '候选（需审核）',
  blocked: '候选（不可行）',
};

function pickBestPlanPerActivity(plans) {
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

function spanOf(entry) {
  if (!entry || !entry.startKey || !entry.endKey) return null;
  return entry.startKey <= entry.endKey ? { startKey: entry.startKey, endKey: entry.endKey } : { startKey: entry.endKey, endKey: entry.startKey };
}

function mergeSpan(target, span) {
  if (!span) return target;
  if (!target) return { ...span };
  return {
    startKey: span.startKey < target.startKey ? span.startKey : target.startKey,
    endKey: span.endKey > target.endKey ? span.endKey : target.endKey,
  };
}

function daySpan(startKey, endKey) {
  const start = parseInstant(`${startKey}T00:00:00+08:00`);
  const end = parseInstant(`${endKey}T00:00:00+08:00`);
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000)) + 1;
}

/**
 * @param {object} domain
 * @param {object} ctx
 * @param {{plans?: object[], site?: string, projectId?: string, horizonDays?: number}} options
 */
export function buildGantt(domain, ctx, options = {}) {
  const chosen = pickBestPlanPerActivity(options.plans);
  const horizon = Math.max(7, Math.min(90, Number(options.horizonDays) || 45));
  const siteFilter = options.site || null;
  const projectFilter = options.projectId || null;

  const specs = domain.specs.filter((spec) => {
    if (projectFilter && spec.projectId !== projectFilter) return false;
    const activities = spec.activityIds.map((id) => domain.specActivities.find((activity) => activity.id === id)).filter(Boolean);
    const hasRecord = activities.length > 0;
    const hasTask = activities.some((activity) => domain.taskById.has(activity.id));
    return hasRecord || hasTask;
  });

  const projects = new Map();
  let activityCount = 0;
  let unscheduled = 0;
  let hours = 0;

  for (const spec of specs) {
    const activities = spec.activityIds
      .map((id) => domain.specActivities.find((activity) => activity.id === id))
      .filter(Boolean)
      .filter((activity) => !siteFilter || activity.site === siteFilter);

    if (activities.length === 0) continue;

    const projectKey = spec.projectId || 'PRJ-UNASSIGNED';
    if (!projects.has(projectKey)) {
      projects.set(projectKey, {
        id: projectKey,
        label: spec.project ?? '（未归属项目）',
        specs: [],
      });
    }
    const project = projects.get(projectKey);

    const activityRows = activities.map((activity) => {
      const plan = chosen.get(activity.id) ?? null;
      const task = domain.taskById.get(activity.id) ?? null;
      const step = activity.step ?? null;
      const standardEffort = step ? round1(((step.testMinutes ?? 0) + (step.prepMinutes ?? 0)) / 60) : null;
      const effort = activity.effortHours ?? task?.effortHours ?? standardEffort ?? 0;
      let startKey = null;
      let endKey = null;
      let source = 'none';
      if (plan) {
        startKey = dateKey(plan.startAt);
        endKey = dateKey(plan.endAt);
        source = 'plan';
      } else if (activity.start) {
        startKey = dateKey(activity.start);
        endKey = dateKey(activity.end ?? activity.start);
        source = 'booking';
      }
      if (!startKey) unscheduled += 1;
      else hours = round1(hours + effort);
      const status = plan?.status ?? spec.status;
      return {
        id: `A:${activity.id}`,
        kind: 'activity',
        level: 4,
        parentId: `S:${spec.id}`,
        label: activity.name,
        sublabel: [activity.resource?.name ?? activity.resourceId, activity.person?.name ?? activity.personId, `${effort}h`, activity.type === 'test_execution' ? '执行记录' : null]
          .filter(Boolean)
          .join(' · '),
        specId: spec.id,
        planNo: activity.planNo ?? spec.planNo ?? null,
        site: activity.site,
        status,
        statusLabel: plan ? STATUS_LABEL[plan.status] ?? plan.status : spec.statusLabel,
        tone: plan ? STATUS_TONE[plan.status] ?? 'brand' : STATUS_TONE[spec.status] ?? 'idle',
        source,
        planId: plan?.id ?? null,
        hours: effort,
        activityId: activity.id,
        startKey,
        endKey,
      };
    });
    activityCount += activityRows.length;

    const activitySpan = activityRows.reduce((span, row) => mergeSpan(span, spanOf(row)), null);
    const specSpan = spanOf({ startKey: spec.windowStart ? dateKey(spec.windowStart) : null, endKey: spec.windowEnd ? dateKey(spec.windowEnd) : null }) ?? activitySpan;

    project.specs.push({
      row: {
        id: `S:${spec.id}`,
        kind: 'spec',
        level: 3,
        parentId: spec.planNo ? `PLAN:${projectKey}:${spec.planNo}` : `P:${projectKey}`,
        label: spec.id,
        sublabel: [spec.title, spec.statusLabel, spec.windowLabel].filter(Boolean).join(' · '),
        specId: spec.id,
        planNo: spec.planNo ?? null,
        site: spec.site,
        status: spec.status,
        statusLabel: spec.statusLabel,
        tone: STATUS_TONE[spec.status] ?? 'idle',
        hours: round1(activityRows.reduce((total, row) => total + row.hours, 0)),
        startKey: specSpan?.startKey ?? null,
        endKey: specSpan?.endKey ?? null,
        planned: activityRows.some((row) => row.source !== 'none'),
      },
      activities: activityRows,
      span: specSpan,
      planNo: spec.planNo ?? null,
    });
  }

  /* flatten: project → PLAN → SPEC → activity ---------------------------- */
  const rows = [];
  const projectSummaries = [];
  for (const project of projects.values()) {
    const allSpecs = project.specs;
    const projectSpan = allSpecs.reduce((span, entry) => mergeSpan(span, entry.span), null);
    const plannedCount = allSpecs.filter((entry) => entry.activities.some((row) => row.source !== 'none')).length;
    rows.push({
      id: `P:${project.id}`,
      kind: 'project',
      level: 1,
      parentId: null,
      label: project.label,
      sublabel: `${allSpecs.length} SPEC · ${plannedCount} 已排`,
      projectId: project.id,
      tone: 'brand',
      startKey: projectSpan?.startKey ?? null,
      endKey: projectSpan?.endKey ?? null,
      hours: round1(allSpecs.reduce((total, entry) => total + (entry.row.hours ?? 0), 0)),
    });
    projectSummaries.push({ id: project.id, label: project.label, specs: allSpecs.length, planned: plannedCount });

    const byPlan = new Map();
    for (const entry of allSpecs) {
      const key = entry.planNo ?? '__none__';
      if (!byPlan.has(key)) byPlan.set(key, []);
      byPlan.get(key).push(entry);
    }

    const planOrder = [...byPlan.keys()].sort((first, second) => (first === '__none__' ? 1 : 0) - (second === '__none__' ? 1 : 0));
    for (const planNo of planOrder) {
      const entries = byPlan.get(planNo);
      if (planNo !== '__none__') {
        const planMeta = domain.planByNo.get(planNo) ?? null;
        const planSpan =
          spanOf({ startKey: planMeta?.windowStart ? dateKey(planMeta.windowStart) : null, endKey: planMeta?.windowEnd ? dateKey(planMeta.windowEnd) : null }) ??
          entries.reduce((span, entry) => mergeSpan(span, entry.span), null);
        rows.push({
          id: `PLAN:${project.id}:${planNo}`,
          kind: 'plan',
          level: 2,
          parentId: `P:${project.id}`,
          label: planNo,
          sublabel: [planMeta?.status, planMeta?.site, `${entries.length} SPEC`].filter(Boolean).join(' · '),
          planNo,
          projectId: project.id,
          tone: 'brand',
          status: planMeta?.status ?? null,
          startKey: planSpan?.startKey ?? null,
          endKey: planSpan?.endKey ?? null,
          hours: round1(entries.reduce((total, entry) => total + (entry.row.hours ?? 0), 0)),
          planStatus: planMeta?.status ?? null,
        });
      }
      for (const entry of entries) {
        rows.push(entry.row);
        for (const activity of entry.activities) rows.push(activity);
      }
    }
  }

  /* time window ---------------------------------------------------------- */
  // The axis follows the planning horizon, not the oldest historical record:
  // completed work from June must not stretch the chart and hide October.
  const todayKey = dateKey(ctx.now);
  const earliestUseful = dateKey(addDays(ctx.now, -7));
  const barSpans = rows.filter((row) => row.startKey && row.endKey && row.endKey >= earliestUseful);
  let minKey = barSpans.reduce((min, row) => (!min || row.startKey < min ? row.startKey : min), null) ?? todayKey;
  let maxKey = barSpans.reduce((max, row) => (!max || row.endKey > max ? row.endKey : max), null) ?? dateKey(addDays(ctx.now, 21));
  if (minKey > todayKey) minKey = todayKey;
  if (minKey < earliestUseful) minKey = earliestUseful;
  if (maxKey < dateKey(addDays(ctx.now, 14))) maxKey = dateKey(addDays(ctx.now, 14));
  const totalDays = Math.min(horizon, Math.max(14, daySpan(minKey, maxKey) + 2));
  const windowStart = startOfDay(`${minKey}T00:00:00+08:00`);
  const days = Array.from({ length: totalDays }, (_, index) => {
    const key = dateKey(addDays(windowStart, index));
    const weekday = dayLabel(`${key}T12:00:00+08:00`);
    return {
      key,
      day: Number(key.slice(8, 10)),
      month: Number(key.slice(5, 7)),
      week: isoWeek(key).week,
      label: formatDate(`${key}T12:00:00+08:00`),
      weekday,
      isWeekend: weekday === '周六' || weekday === '周日',
      isToday: key === todayKey,
    };
  });
  const startKeyOfWindow = days[0]?.key ?? minKey;
  const endKeyOfWindow = days[days.length - 1]?.key ?? maxKey;
  const indexOfDay = new Map(days.map((day, index) => [day.key, index]));
  const toSpan = (startKey, endKey) => {
    if (!startKey || !endKey) return null;
    if (endKey < startKeyOfWindow || startKey > endKeyOfWindow) return null;
    const from = startKey < startKeyOfWindow ? 0 : indexOfDay.get(startKey) ?? null;
    const to = endKey > endKeyOfWindow ? days.length - 1 : indexOfDay.get(endKey) ?? null;
    if (from === null || to === null) return null;
    return { from, to: Math.max(from, to) };
  };

  // 1) first pass: local spans + off-window flags
  for (const row of rows) {
    row.span = toSpan(row.startKey, row.endKey);
    row.offWindow = Boolean(row.startKey && row.endKey) && row.span === null;
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const childrenOf = new Map();
  for (const row of rows) {
    if (!row.parentId) continue;
    if (!childrenOf.has(row.parentId)) childrenOf.set(row.parentId, []);
    childrenOf.get(row.parentId).push(row);
  }

  // 2) parents inherit the span of their *visible* children, so a project does
  // not stretch back to June just because one historical spec sits under it.
  const rollup = (id) => {
    const row = rowsById.get(id);
    if (!row) return;
    const children = childrenOf.get(id) ?? [];
    for (const child of children) if (child.kind !== 'activity') rollup(child.id);
    const visibleChildren = children.filter((child) => child.span && !child.offWindow);
    if (row.kind !== 'activity' && visibleChildren.length > 0) {
      row.startKey = visibleChildren.reduce((min, child) => (!min || child.startKey < min ? child.startKey : min), null) ?? row.startKey;
      row.endKey = visibleChildren.reduce((max, child) => (!max || child.endKey > max ? child.endKey : max), null) ?? row.endKey;
    }
  };
  for (const row of rows) if (row.kind === 'project') rollup(row.id);

  // 3) second pass: recompute after the rollup so parents match their children
  const visible = rows.map((row) => {
    const span = toSpan(row.startKey, row.endKey);
    return {
      ...row,
      span,
      offWindow: Boolean(row.startKey && row.endKey) && span === null,
      clippedStart: Boolean(row.startKey && row.startKey < startKeyOfWindow),
      clippedEnd: Boolean(row.endKey && row.endKey > endKeyOfWindow),
    };
  });

  return {
    ok: true,
    window: {
      startKey: startKeyOfWindow,
      endKey: endKeyOfWindow,
      days: days.map((day) => ({ ...day })),
      label: `${formatDate(`${startKeyOfWindow}T12:00:00+08:00`)}–${formatDate(`${endKeyOfWindow}T12:00:00+08:00`)}`,
    },
    rows: visible,
    projects: projectSummaries,
    summary: {
      projects: projects.size,
      plans: rows.filter((row) => row.kind === 'plan').length,
      specs: rows.filter((row) => row.kind === 'spec').length,
      activities: activityCount,
      scheduled: activityCount - unscheduled,
      unscheduled,
      hours: round1(hours),
      sites: [...new Set(specs.map((spec) => spec.site).filter(Boolean))],
    },
    legend: {
      levels: ['Project', 'PLAN 批次', 'SPEC', '规格活动'],
      tones: {
        brand: '候选 / 计划中',
        ok: '已确认',
        warn: '已占位 / 执行中',
        idle: '记录 / 未排',
        error: '不可行',
      },
    },
    ruleVersion: domain.config?.ruleVersion ?? null,
  };
}
