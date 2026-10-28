/**
 * Host JSON routes. They sit behind DSH's existing browser authentication fence
 * (`ctx.connection.fetch.register`), so the page uses the same cookie as chat.
 */
import { analyzeDowntime, buildOverview, comparePlans, computeAnalytics, createEngineContext, equipmentBookings, explainResource, generatePlans, generateTestPlan, projectDetail, projectSummaries, resourcePage, resourceSchedule, taskDetail } from './engine.js';
import { createTaskDrafts, prepareTaskDrafts } from './drafts.js';
import { isReviewTask } from './model.js';
import {
  addAudit,
  addDowntime,
  loadDomain,
  readAudit,
  readPlan,
  readPlansByIds,
  readActivePlans,
  readDowntime,
  readPlansForTask,
  readTestPlan,
  readTestPlans,
  readWorkspace,
  removeDowntime,
  savePlans,
  saveTestPlan,
  seedDatabase,
  writeWorkspace,
} from './seed.js';
import { dateKey, diffHours, formatDate, parseInstant, priorityRank, round1, sum } from './util.js';

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

function fail(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function makeContext(db, domain, config) {
  const now = parseInstant(config?.demoNow ?? '2026-10-27T08:00:00+08:00');
  const downtime = await readDowntime(db);
  return createEngineContext(domain, now, { downtime });
}

function overviewPayload(domain, ctx, audit, plans = []) {
  const recentAudit = audit.slice(0, 6);
  const overview = buildOverview(domain, ctx);
  const activeByTask = new Map();
  for (const plan of plans) {
    if (!plan || plan.status === 'superseded' || !Array.isArray(plan.segments) || plan.segments.length === 0) continue;
    if (!activeByTask.has(plan.taskId)) activeByTask.set(plan.taskId, plan);
  }
  const scheduledTasks = domain.tasks.filter((task) => activeByTask.has(task.id)).length;
  overview.stats.scheduledTasks = scheduledTasks;
  overview.stats.unscheduledTasks = domain.tasks.length - scheduledTasks;
  overview.tasks = overview.tasks.map((task) => ({
    ...task,
    risk: overview.riskTasks.includes(task.id) ? (task.review ? 'medium' : 'high') : 'low',
    scheduled: activeByTask.has(task.id),
    planId: activeByTask.get(task.id)?.id ?? null,
  }));
  return { ...overview, recentAudit };
}

function tasksPayload(domain, ctx, audit) {
  const tasks = domain.tasks
    .map((task) => {
      const daysLeft = Math.ceil(diffHours(task.dueDate, ctx.now) / 24);
      const capacity = Math.max(1, daysLeft + 1) * 6;
      const loadPct = Math.round((task.effortHours / capacity) * 100);
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
        dueDate: task.dueDate.toISOString(),
        dueLabel: formatDate(task.dueDate, true),
        requestedStart: task.requestedStart?.toISOString() ?? null,
        daysLeft,
        effortHours: task.effortHours,
        loadPct,
        review: isReviewTask(task),
        equipmentIds: task.requirements.equipmentIds,
        equipmentType: task.requirements.equipmentType,
        spaceIds: task.requirements.spaceIds,
        qualifications: task.requirements.qualifications,
        readiness: isReviewTask(task) ? 'needs_review' : 'ready',
        risk: loadPct >= 100 || daysLeft < 0 ? 'high' : loadPct >= 65 || isReviewTask(task) ? 'medium' : 'low',
      };
    })
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.dueDate.localeCompare(b.dueDate));
  return { tasks, total: tasks.length, recentAudit: audit.slice(0, 4) };
}

async function handlePlans(db, config, request) {
  const body = await readBody(request);
  const taskId = body.taskId;
  if (!taskId) return fail('缺少 taskId', 400);
  const domain = await loadDomain(db);
  const task = domain.taskById.get(taskId);
  if (!task) return fail(`找不到任务 ${taskId}`, 404);
  const previous = body.previousPlanId ? await readPlan(db, body.previousPlanId) : null;
  const ctx = await makeContext(db, domain, config);
  const result = generatePlans(ctx, task, {
    count: body.count,
    preferredEquipmentId: body.preferredEquipmentId,
    preferredPersonId: body.preferredPersonId,
    avoidFridayAfternoon: body.avoidFridayAfternoon,
    earliestStart: body.earliestStart,
  });
  if (result.plans.length > 0) {
    const suffix = `-${Date.now().toString(36).slice(-4).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
    for (const plan of result.plans) plan.id = `${plan.id}${suffix}`;
  }
  const comparison = previous ? comparePlans(previous, result.plans[0] ?? null) : null;
  if (result.plans.length > 0) {
    await savePlans(db, result.plans);
    await addAudit(db, {
      type: previous ? 'plan_revised' : 'plans_generated',
      actor: body.actor ?? 'workspace',
      summary: previous
        ? `按新约束重排 ${task.id}（${result.plans.length} 个候选）`
        : `为 ${task.id} 生成 ${result.plans.length} 个候选方案`,
      detail: previous
        ? `变更前 ${previous.id} → 变更后 ${result.plans[0].id}；完成时间 ${comparison?.completionDeltaHours > 0 ? '+' : ''}${comparison?.completionDeltaHours ?? '—'}h；资源变化 ${comparison?.resourceChanges.length ?? 0} 项。`
        : result.plans.map((plan) => `${plan.id} ${plan.strategyLabel}（${plan.score} 分）`).join('；'),
      taskId: task.id,
      planId: result.plans[0].id,
    });
  } else {
    await addAudit(db, {
      type: 'plans_blocked',
      actor: body.actor ?? 'workspace',
      summary: `为 ${task.id} 生成方案失败`,
      detail: result.diagnostics.map((item) => item.text).join('；'),
      taskId: task.id,
    });
  }
  const targetPage = body.page === 'dashboard' ? 'dashboard' : 'schedule';
  const workspace = await writeWorkspace(db, {
    page: targetPage,
    taskId: task.id,
    planIds: result.plans.map((plan) => plan.id),
    selectedPlanId: result.plans[0]?.id ?? null,
    comparison,
    message:
      result.plans.length > 0
        ? previous
          ? `已按新约束重排「${task.name}」，右侧显示前后对比。`
          : `已为「${task.name}」生成 ${result.plans.length} 个候选方案。`
        : `「${task.name}」当前没有可行方案，请查看冲突诊断。`,
    source: body.actor ?? 'workspace',
  });
  return json({ ok: true, ...result, comparison, workspace, task: { id: task.id, name: task.name } });
}

async function handleConfirm(db, config, request) {
  const body = await readBody(request);
  const planId = body.planId;
  if (!planId) return fail('缺少 planId', 400);
  const domain = await loadDomain(db);
  const ctx = await makeContext(db, domain, config);
  const plan = await readPlan(db, planId);
  if (!plan) return fail(`找不到方案 ${planId}`, 404);
  const task = domain.taskById.get(plan.taskId);
  if (!task) return fail(`找不到方案对应任务 ${plan.taskId}`, 404);
  if (plan.status === 'confirmed') {
    return json({ ok: true, alreadyConfirmed: true, plan, simulated: true });
  }
  if (plan.status === 'superseded') {
    return fail('该方案已被新版本替代，请在最新候选中确认', 409, { code: 'superseded', plan });
  }
  if (isReviewTask(task) || plan.status === 'needs_review') {
    return fail('该任务是非标准方法，必须先完成方法/资质人工审核（模拟环境不绕过审核）', 409, {
      code: 'needs_review',
      plan,
      evaluations: plan.evaluations,
    });
  }
  if (!plan.feasible) {
    return fail('该方案未通过硬约束校验，不能确认', 409, { code: 'infeasible', plan });
  }
  const conflicts = [];
  const equipment = domain.equipmentById.get(plan.resources.equipment.id);
  const person = domain.personById.get(plan.resources.person.id);
  if (!equipment || equipment.status !== 'Operational') {
    conflicts.push(`${plan.resources.equipment.name} 当前状态为 ${equipment?.status ?? '不存在'}（HC-003）`);
  }
  if (!person || person.status !== 'Active') {
    conflicts.push(`${plan.resources.person.name} 当前不可用（HC-002）`);
  }
  if (equipment?.calibrationDue && plan.segments.some((segment) => segment.day > equipment.calibrationDue)) {
    conflicts.push(`${equipment.name} 的校准/维护到期日 ${equipment.calibrationDue} 早于计划执行日（HC-003）`);
  }
  if (person && task.requirements.qualifications.length > 0) {
    const missing = task.requirements.qualifications.filter((qualification) => !person.qualifications.includes(qualification));
    if (missing.length > 0 && !isReviewTask(task)) {
      conflicts.push(`${person.name} 缺少资质：${missing.join('、')}（HC-002）`);
    }
  }
  const equipmentCapacity = equipment ? (equipment.availableTo - equipment.availableFrom) / 60 : 8;
  const space = plan.resources.space ? domain.spaceById.get(plan.resources.space.id) : null;
  for (const segment of plan.segments) {
    if (ctx.downtime?.has(`${equipment?.id}|${segment.day}`)) {
      conflicts.push(`${segment.dateLabel} ${equipment?.name ?? '设备'} 处于计划停机窗口（HC-004 / HC-003）`);
    }
    const otherPersonLoad = domain.allocations
      .filter((item) => item.personId === person?.id && item.date === segment.day && item.taskId !== task.id)
      .reduce((total, item) => total + item.load, 0);
    const otherEquipmentLoad = domain.allocations
      .filter((item) => item.resourceId === equipment?.id && item.date === segment.day && item.taskId !== task.id)
      .reduce((total, item) => total + item.load, 0);
    const otherSpaceLoad = space
      ? domain.allocations
          .filter((item) => item.resourceId === space.id && item.date === segment.day && item.taskId !== task.id)
          .reduce((total, item) => total + item.load, 0)
      : 0;
    const blocked = domain.activities
      .filter((item) => item.personId === person?.id && dateKey(item.start) <= segment.day && dateKey(item.end) >= segment.day)
      .reduce((total, item) => total + item.blockedHours, 0);
    if (otherPersonLoad + blocked + segment.hours > (person?.dailyCapacityHours ?? 8) + 0.01) {
      conflicts.push(`${segment.dateLabel} 人员容量不足：已有 ${round1(otherPersonLoad + blocked)}h，新增 ${segment.hours}h`);
    }
    if (otherEquipmentLoad + segment.hours > equipmentCapacity + 0.01) {
      conflicts.push(`${segment.dateLabel} 设备容量不足：已有 ${round1(otherEquipmentLoad)}h，可用 ${round1(equipmentCapacity)}h，新增 ${segment.hours}h`);
    }
    if (space && otherSpaceLoad + segment.hours > (space.availableTo - space.availableFrom) / 60 + 0.01) {
      conflicts.push(`${segment.dateLabel} 前处理空间 ${space.name} 容量不足`);
    }
  }
  if (conflicts.length > 0) {
    return fail('提交前重新校验失败，资源状态已变化', 409, { code: 'revalidate_failed', conflicts, plan });
  }
  const allocations = [];
  for (const segment of plan.segments) {
    allocations.push({
      _id: `AL-${planId}-${segment.day}-P`,
      allocation_id: `AL-${planId}-${segment.day}-P`,
      task_id: task.id,
      person_id: segment.personId,
      resource_id: '',
      allocation_date: segment.day,
      allocation_type: 'Person effort',
      planned_load: String(segment.hours),
      load_unit: 'hour',
      notes: `Prototype confirmed from ${planId} (simulated, no production write).`,
      source: 'confirmed_plan',
      plan_id: planId,
    });
    allocations.push({
      _id: `AL-${planId}-${segment.day}-R`,
      allocation_id: `AL-${planId}-${segment.day}-R`,
      task_id: task.id,
      person_id: '',
      resource_id: segment.equipmentId,
      allocation_date: segment.day,
      allocation_type: 'Resource reservation',
      planned_load: String(segment.hours),
      load_unit: 'hour',
      notes: `Prototype confirmed from ${planId} (simulated, no production write).`,
      source: 'confirmed_plan',
      plan_id: planId,
    });
    if (segment.spaceId) {
      allocations.push({
        _id: `AL-${planId}-${segment.day}-S`,
        allocation_id: `AL-${planId}-${segment.day}-S`,
        task_id: task.id,
        person_id: '',
        resource_id: segment.spaceId,
        allocation_date: segment.day,
        allocation_type: 'Resource reservation',
        planned_load: String(segment.hours),
        load_unit: 'hour',
        notes: `Prototype confirmed from ${planId} (simulated, no production write).`,
        source: 'confirmed_plan',
        plan_id: planId,
      });
    }
    // Also keep the plan's daily equipment reservation when no space is used.
    if (!segment.spaceId) {
      // no-op: equipment reservation was added above
    }
  }
  await db.collection('raw_allocations').deleteMany({ task_id: task.id, source: 'confirmed_plan' });
  await db.collection('raw_allocations').deleteMany({ task_id: task.id, plan_id: { $exists: false } });
  if (allocations.length > 0) await db.collection('raw_allocations').insertMany(allocations, { ordered: false });
  await db.collection('plans').updateOne(
    { planId },
    {
      $set: {
        status: 'confirmed',
        statusLabel: '已模拟确认',
        confirmedAt: new Date().toISOString(),
        confirmedBy: body.actor ?? 'workspace',
      },
    },
  );
  await db.collection('raw_tasks').updateOne({ task_id: task.id }, { $set: { status: 'Scheduled' } });
  const audit = await addAudit(db, {
    type: 'plan_confirmed',
    actor: body.actor ?? 'workspace',
    summary: `模拟确认 ${planId}（${task.name}）`,
    detail: `${plan.resources.equipment.name} + ${plan.resources.person.name}；${plan.segments.length} 个工作日；未写入生产系统，已更新原型资源占用与审计。`,
    taskId: task.id,
    planId,
  });
  const workspace = await writeWorkspace(db, {
    page: 'schedule',
    taskId: task.id,
    planIds: [planId],
    selectedPlanId: planId,
    message: `已模拟确认 ${planId}。生产环境中此步骤会经过权限、审批与正式资源锁定。`,
    source: body.actor ?? 'workspace',
  });
  const updated = await readPlan(db, planId);
  return json({ ok: true, simulated: true, plan: updated, allocations: allocations.length, audit, workspace });
}

async function handleExplain(db, config, request) {
  const body = await readBody(request);
  const resourceId = body.resourceId;
  if (!resourceId) return fail('缺少 resourceId', 400);
  const domain = await loadDomain(db);
  const ctx = await makeContext(db, domain, config);
  const result = explainResource(ctx, resourceId, body.taskId);
  if (!result.found) return fail(`找不到资源 ${resourceId}`, 404);
  await addAudit(db, {
    type: 'resource_explained',
    actor: body.actor ?? 'workspace',
    summary: `解释资源 ${resourceId} 的可用性`,
    detail: result.reasons.join('；'),
    resourceId,
    taskId: body.taskId ?? null,
  });
  const workspace = await writeWorkspace(db, {
    page: 'resources',
    resourceId,
    message: result.usable
      ? `${result.resource.name} 当前可用。${result.reasons[0] ?? ''}`
      : `${result.resource.name} 当前不可用：${result.reasons.join('；')}`,
    source: body.actor ?? 'workspace',
  });
  return json({ ok: true, ...result, workspace });
}

async function handleSimulate(db, config, request) {
  const body = await readBody(request);
  const domain = await loadDomain(db);
  const ctx = await makeContext(db, domain, config);
  const type = body.equipmentType || domain.equipment[0]?.type;
  const addCount = Math.max(1, Math.min(3, Number(body.addCount) || 1));
  const typeEquipment = domain.equipment.filter((item) => item.type === type);
  const windowDays = 14;
  const currentCapacity = typeEquipment.reduce((total, item) => total + ((item.availableTo - item.availableFrom) / 60) * windowDays, 0);
  const currentUsed = domain.allocations
    .filter((item) => item.resourceId && typeEquipment.some((equipment) => equipment.id === item.resourceId))
    .filter((item) => item.date >= dateKey(ctx.start) && item.date <= dateKey(new Date(ctx.start.getTime() + windowDays * 86400000)))
    .reduce((total, item) => total + item.load, 0);
  const extraCapacity = addCount * 8 * windowDays;
  const affected = domain.tasks.filter(
    (task) => task.requirements.equipmentType === type && diffHours(task.dueDate, ctx.now) <= windowDays * 24,
  );
  const backlog = sum(affected.map((task) => task.effortHours));
  const slackBefore = currentCapacity - currentUsed - backlog;
  const slackAfter = slackBefore + extraCapacity;
  const delayRiskBefore = Math.max(0, Math.round((-slackBefore / Math.max(1, backlog)) * affected.length));
  const delayRiskAfter = Math.max(0, Math.round((-slackAfter / Math.max(1, backlog)) * affected.length));
  await addAudit(db, {
    type: 'scenario_simulated',
    actor: body.actor ?? 'workspace',
    summary: `情景模拟：增加 ${addCount} 台 ${type}`,
    detail: `新增产能 ${round1(extraCapacity)}h；受影响任务 ${affected.length} 个；延期风险 ${delayRiskBefore} → ${delayRiskAfter}（示意性估算）。`,
  });
  return json({
    ok: true,
    scenario: {
      equipmentType: type,
      addCount,
      windowDays,
      currentCapacity: round1(currentCapacity),
      currentUsed: round1(currentUsed),
      extraCapacity: round1(extraCapacity),
      affectedTasks: affected.length,
      backlogHours: round1(backlog),
      slackBefore: round1(slackBefore),
      slackAfter: round1(slackAfter),
      delayRiskBefore,
      delayRiskAfter,
      note: '示意性产能估算：按每台设备 8h/工作日、14 天窗口计算，未重新求解全部排程。正式方案需运行完整约束优化。',
      affected: affected.map((task) => ({ id: task.id, name: task.name, dueDate: task.dueDate.toISOString(), effortHours: task.effortHours })),
    },
    workspace: await writeWorkspace(db, {
      page: 'analytics',
      message: `情景模拟：增加 ${addCount} 台 ${type}，预计释放 ${round1(extraCapacity)}h 产能。`,
      source: body.actor ?? 'workspace',
    }),
  });
}

async function handleDowntime(db, config, request) {
  const body = await readBody(request);
  if (!body.equipmentId || !body.date) return fail('缺少 equipmentId 或 date', 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return fail('date 必须是 YYYY-MM-DD', 400);
  const domainBefore = await loadDomain(db);
  if (!domainBefore.equipmentById.get(body.equipmentId)) return fail(`找不到设备 ${body.equipmentId}`, 404);
  const downtime = await addDowntime(db, {
    equipmentId: body.equipmentId,
    date: body.date,
    reason: body.reason ?? '计划维护',
    actor: body.actor ?? 'workspace',
  });
  const domain = await loadDomain(db);
  const ctx = await makeContext(db, domain, config);
  const impact = analyzeDowntime(ctx, body.equipmentId, body.date, downtime.reason);
  await addAudit(db, {
    type: 'downtime_registered',
    actor: body.actor ?? 'workspace',
    summary: `登记停机：${impact.found ? impact.equipment.name : body.equipmentId} ${body.date}`,
    detail: `${downtime.reason}；受影响任务 ${impact.summary?.affected ?? 0} 个，可重排 ${impact.summary?.replannable ?? 0} 个，可能延期 ${impact.summary?.late ?? 0} 个。`,
    resourceId: body.equipmentId,
  });
  const workspace = await writeWorkspace(db, {
    page: 'impact',
    equipmentId: body.equipmentId,
    date: body.date,
    message: `已登记 ${impact.found ? impact.equipment.name : body.equipmentId} 在 ${body.date} 的停机；右侧显示影响分析。`,
    source: body.actor ?? 'workspace',
  });
  return json({ ok: true, downtime, impact, workspace });
}

/**
 * @param {{db: import('mongodb').Db, config: object}} store
 * @returns {{path: string, methods: string[], requestBody: string, fetch: (request: Request) => Promise<Response>}[]}
 */
export function buildRoutes(store) {
  const { db, config } = store;
  const wrap = (handler) => async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      console.error('[agentic-lims] route failed', error);
      return fail(error instanceof Error ? error.message : String(error), 500);
    }
  };

  return [
    {
      path: '/api/lims/health',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async () => {
        const meta = await db.collection('meta').findOne({ _id: 'seed' });
        const workspace = await readWorkspace(db);
        return json({
          ok: true,
          mongo: 'connected',
          seed: meta?.version ?? null,
          seededAt: meta?.seededAt ?? null,
          demoNow: config?.demoNow ?? '2026-10-27T08:00:00+08:00',
          workspaceRevision: workspace.revision,
        });
      }),
    },
    {
      path: '/api/lims/overview',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async () => {
        const domain = await loadDomain(db);
        const ctx = await makeContext(db, domain, config);
        const audit = await readAudit(db, 20);
        const plans = await readActivePlans(db);
        return json({ ok: true, ...overviewPayload(domain, ctx, audit, plans) });
      }),
    },
    {
      path: '/api/lims/tasks',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async () => {
        const domain = await loadDomain(db);
        const ctx = await makeContext(db, domain, config);
        const audit = await readAudit(db, 10);
        return json({ ok: true, ...tasksPayload(domain, ctx, audit) });
      }),
    },
    {
      path: '/api/lims/task',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async (request) => {
        const url = new URL(request.url);
        const taskId = url.searchParams.get('taskId');
        if (!taskId) return fail('缺少 taskId', 400);
        const domain = await loadDomain(db);
        const ctx = await makeContext(db, domain, config);
        const plans = await readPlansForTask(db, taskId);
        const detail = taskDetail(domain, ctx, taskId, plans);
        if (!detail) return fail(`找不到任务 ${taskId}`, 404);
        return json({ ok: true, ...detail });
      }),
    },
    {
      path: '/api/lims/resources',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async () => {
        const domain = await loadDomain(db);
        const ctx = await makeContext(db, domain, config);
        return json({ ok: true, ...resourcePage(domain, ctx) });
      }),
    },
    {
      path: '/api/lims/analytics',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async () => {
        const domain = await loadDomain(db);
        const ctx = await makeContext(db, domain, config);
        const audit = await readAudit(db, 6);
        return json({ ok: true, ...computeAnalytics(domain, ctx, audit) });
      }),
    },
    {
      path: '/api/lims/requests',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async () => {
        const domain = await loadDomain(db);
        const requests = domain.requests.map((request) => ({
          id: request.id,
          orderId: request.orderId,
          templateId: request.templateId,
          templateName: domain.templateById.get(request.templateId)?.name ?? null,
          name: request.name,
          priority: request.priority,
          requestedAt: request.requestedAt?.toISOString() ?? null,
          dueAt: request.dueAt?.toISOString() ?? null,
          sampleCount: request.sampleCount,
          summary: request.summary,
          ruleStatus: request.ruleStatus,
        }));
        return json({ ok: true, requests });
      }),
    },
    {
      path: '/api/lims/task-draft/prepare',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: wrap(async (request) => {
        const body = await readBody(request);
        if (!body.projectId) return fail('缺少 projectId', 400);
        const domain = await loadDomain(db);
        const result = prepareTaskDrafts(domain, body.projectId, {
          requestText: body.requestText,
          requestId: body.requestId,
          templateId: body.templateId,
          name: body.name,
          method: body.method,
          priority: body.priority,
          dueDate: body.dueDate,
          requestedStart: body.requestedStart ?? dateKey(config.demoNow),
          effortHours: body.effortHours,
          elapsedDays: body.elapsedDays,
          qualifications: body.qualifications,
          equipmentIds: body.equipmentIds,
          spaceIds: body.spaceIds,
        });
        if (!result.found) return fail(result.error, 404);
        return json({ ok: true, ...result });
      }),
    },
    {
      path: '/api/lims/task-drafts',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: wrap(async (request) => {
        const body = await readBody(request);
        if (!body.projectId) return fail('缺少 projectId', 400);
        const domain = await loadDomain(db);
        const result = await createTaskDrafts(db, domain, body.projectId, body.drafts, body.actor ?? 'agent');
        if (!result.ok) return fail(result.error, 400);
        await addAudit(db, {
          type: 'task_drafts_created',
          actor: body.actor ?? 'agent',
          summary: `从 request 拆解创建 ${result.created.length} 个任务`,
          detail: result.created.map((task) => `${task.id} ${task.name}（${task.templateId}）`).join('；'),
          projectId: body.projectId,
        });
        const workspace = await writeWorkspace(db, {
          page: 'projects',
          projectId: body.projectId,
          message: `已从 request 拆解创建 ${result.created.length} 个任务，可在项目页查看并继续排程。`,
          source: body.actor ?? 'agent',
        });
        return json({ ok: true, ...result, workspace });
      }),
    },
    {
      path: '/api/lims/templates',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async () => {
        const domain = await loadDomain(db);
        const templates = domain.templates.map((template) => {
          const tasks = domain.tasks.filter((task) => task.templateId === template.id);
          const projects = new Map();
          for (const task of tasks) {
            if (!projects.has(task.projectId)) projects.set(task.projectId, { id: task.projectId, name: task.projectName, taskCount: 0 });
            projects.get(task.projectId).taskCount += 1;
          }
          return {
            id: template.id,
            name: template.name,
            methodCode: template.methodCode,
            requiredEquipmentType: template.requiredEquipmentType,
            requiredQualification: template.requiredQualification,
            requiredSpaceId: template.requiredSpaceId,
            prepMinutes: template.prepMinutes,
            testMinutes: template.testMinutes,
            notes: template.notes,
            taskCount: tasks.length,
            projects: [...projects.values()].sort((a, b) => a.id.localeCompare(b.id)),
          };
        });
        const unmatchedTasks = domain.tasks
          .filter((task) => !task.templateId)
          .map((task) => ({ id: task.id, name: task.name, projectId: task.projectId, projectName: task.projectName }));
        return json({ ok: true, templates, unmatchedTasks });
      }),
    },
    {
      path: '/api/lims/task-template',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: wrap(async (request) => {
        const body = await readBody(request);
        if (!body.taskId) return fail('缺少 taskId', 400);
        const domain = await loadDomain(db);
        const task = domain.taskById.get(body.taskId);
        if (!task) return fail(`找不到任务 ${body.taskId}`, 404);
        const templateId = body.templateId || null;
        if (templateId && !domain.templateById.has(templateId)) return fail(`找不到模板 ${templateId}`, 404);
        if (templateId) {
          await db.collection('task_template_overrides').updateOne(
            { _id: task.id },
            { $set: { templateId, updatedAt: new Date().toISOString(), actor: body.actor ?? 'workspace' } },
            { upsert: true },
          );
        } else {
          await db.collection('task_template_overrides').deleteOne({ _id: task.id });
        }
        await addAudit(db, {
          type: 'template_mapping_changed',
          actor: body.actor ?? 'workspace',
          summary: templateId ? `修改 ${task.id} 的模板映射为 ${templateId}` : `重置 ${task.id} 为自动模板匹配`,
          detail: templateId
            ? `任务「${task.name}」的模板从 ${task.templateId ?? '未匹配'} 改为 ${templateId}；项目分组与后续测试计划会使用新模板。`
            : `任务「${task.name}」恢复按方法/设备自动匹配模板；项目分组与后续测试计划会重新计算。`,
          taskId: task.id,
        });
        return json({ ok: true, taskId: task.id, projectId: task.projectId, templateId });
      }),
    },
    {
      path: '/api/lims/projects',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async () => {
        const domain = await loadDomain(db);
        const ctx = await makeContext(db, domain, config);
        const testPlans = await readTestPlans(db);
        return json({ ok: true, projects: projectSummaries(domain, ctx, testPlans) });
      }),
    },
    {
      path: '/api/lims/project',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async (request) => {
        const url = new URL(request.url);
        const projectId = url.searchParams.get('projectId');
        if (!projectId) return fail('缺少 projectId', 400);
        const domain = await loadDomain(db);
        const ctx = await makeContext(db, domain, config);
        const testPlans = await readTestPlans(db, projectId);
        const detail = projectDetail(domain, ctx, projectId, testPlans);
        if (!detail) return fail(`找不到项目 ${projectId}`, 404);
        return json({ ok: true, ...detail });
      }),
    },
    {
      path: '/api/lims/test-plan',
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: wrap(async (request) => {
        if (request.method === 'GET') {
          const url = new URL(request.url);
          const testPlanId = url.searchParams.get('testPlanId');
          if (!testPlanId) return fail('缺少 testPlanId', 400);
          const testPlan = await readTestPlan(db, testPlanId);
          if (!testPlan) return fail(`找不到测试计划 ${testPlanId}`, 404);
          return json({ ok: true, testPlan });
        }
        const body = await readBody(request);
        if (!body.projectId) return fail('缺少 projectId', 400);
        const domain = await loadDomain(db);
        const ctx = await makeContext(db, domain, config);
        const result = generateTestPlan(ctx, body.projectId, body.templateId ?? null, { actor: body.actor ?? 'workspace' });
        if (!result.found) return fail(`找不到项目 ${body.projectId}`, 404);
        if (!result.testPlan) return json({ ok: true, projectId: body.projectId, testPlan: null, diagnostics: result.diagnostics });
        for (const plan of result.plans) await savePlans(db, [plan]);
        await saveTestPlan(db, result.testPlan);
        await addAudit(db, {
          type: 'test_plan_generated',
          actor: body.actor ?? 'workspace',
          summary: `为 ${result.testPlan.projectName} 生成测试计划（${result.testPlan.templateName}）`,
          detail: `任务 ${result.testPlan.summary.scheduled}/${result.testPlan.summary.taskCount} 已排；${result.testPlan.summary.late} 项晚于交期；${result.testPlan.summary.unscheduled} 项阻塞。`,
          taskId: result.testPlan.taskIds[0] ?? null,
          planId: result.testPlan.id,
        });
        const workspace = await writeWorkspace(db, {
          page: 'projects',
          projectId: result.testPlan.projectId,
          testPlanId: result.testPlan.id,
          message: `已生成测试计划「${result.testPlan.templateName}」：${result.testPlan.summary.scheduled} 个任务已排入。`,
          source: body.actor ?? 'workspace',
        });
        return json({ ok: true, ...result, workspace });
      }),
    },
    {
      path: '/api/lims/resource-schedule',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async (request) => {
        const url = new URL(request.url);
        const weekStart = url.searchParams.get('weekStart');
        const weekCount = Number(url.searchParams.get('weekCount')) || 1;
        const domain = await loadDomain(db);
        const ctx = await makeContext(db, domain, config);
        const plans = await readActivePlans(db);
        const schedule = resourceSchedule(ctx, plans, weekStart, weekCount);
        return json({ ok: true, ...schedule });
      }),
    },
    {
      path: '/api/lims/audit',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async () => {
        const events = await readAudit(db, 80);
        return json({ ok: true, events });
      }),
    },
    {
      path: '/api/lims/workspace',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async () => {
        const workspace = await readWorkspace(db);
        const plans = await readPlansByIds(db, workspace.planIds ?? []);
        return json({ ok: true, ...workspace, plans });
      }),
    },
    {
      path: '/api/lims/plans',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: wrap((request) => handlePlans(db, config, request)),
    },
    {
      path: '/api/lims/confirm',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: wrap((request) => handleConfirm(db, config, request)),
    },
    {
      path: '/api/lims/downtime',
      methods: ['POST', 'DELETE'],
      requestBody: 'buffered',
      fetch: wrap(async (request) => {
        if (request.method !== 'DELETE') return handleDowntime(db, config, request);
        const url = new URL(request.url);
        const equipmentId = url.searchParams.get('equipmentId');
        const date = url.searchParams.get('date');
        if (!equipmentId || !date) return fail('缺少 equipmentId 或 date', 400);
        const removed = await removeDowntime(db, { equipmentId, date });
        if (removed) {
          await addAudit(db, {
            type: 'downtime_removed',
            actor: 'workspace',
            summary: `撤销停机：${equipmentId} ${date}`,
            detail: '该停机窗口已从影响分析中移除。',
            resourceId: equipmentId,
          });
        }
        return json({ ok: true, removed });
      }),
    },
    {
      path: '/api/lims/impact',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async (request) => {
        const url = new URL(request.url);
        const equipmentId = url.searchParams.get('equipmentId');
        const date = url.searchParams.get('date');
        if (!equipmentId || !date) return fail('缺少 equipmentId 或 date', 400);
        const domain = await loadDomain(db);
        const ctx = await makeContext(db, domain, config);
        const impact = analyzeDowntime(ctx, equipmentId, date);
        if (!impact.found) return fail(`找不到设备 ${equipmentId}`, 404);
        const registered = (await readDowntime(db)).some(
          (entry) => entry.equipmentId === equipmentId && entry.date === date,
        );
        return json({ ok: true, impact, registered });
      }),
    },
    {
      path: '/api/lims/bookings',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: wrap(async (request) => {
        const url = new URL(request.url);
        const equipmentId = url.searchParams.get('equipmentId');
        const date = url.searchParams.get('date');
        if (!equipmentId || !date) return fail('缺少 equipmentId 或 date', 400);
        const domain = await loadDomain(db);
        const ctx = await makeContext(db, domain, config);
        const result = equipmentBookings(ctx, equipmentId, date);
        if (!result.found) return fail(`找不到设备 ${equipmentId}`, 404);
        return json({ ok: true, ...result });
      }),
    },
    {
      path: '/api/lims/explain',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: wrap((request) => handleExplain(db, config, request)),
    },
    {
      path: '/api/lims/focus',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: wrap(async (request) => {
        const body = await readBody(request);
        const allowed = new Set(['dashboard', 'projects', 'tasks', 'task', 'schedule', 'resources', 'analytics', 'audit']);
        if (!allowed.has(body.page)) return fail('无效页面', 400);
        const workspace = await writeWorkspace(db, {
          page: body.page,
          taskId: body.taskId ?? null,
          resourceId: body.resourceId ?? null,
          message: body.message ?? '',
          source: body.actor ?? 'workspace',
        });
        return json({ ok: true, workspace });
      }),
    },
    {
      path: '/api/lims/simulate',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: wrap((request) => handleSimulate(db, config, request)),
    },
    {
      path: '/api/lims/seed',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: wrap(async (request) => {
        const body = await readBody(request);
        const result = await seedDatabase(db, { force: body.force === true });
        return json({ ok: true, ...result });
      }),
    },
  ];
}
