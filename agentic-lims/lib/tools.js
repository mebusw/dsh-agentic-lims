/**
 * Model-facing LIMS tools. They call the same HTTP handlers the page uses, so
 * feasibility, revalidation and audit behavior cannot drift between chat and UI.
 */

function text(value) {
  return [{ type: 'text', text: value }];
}

function schema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

const OUTPUT = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
};

function withMeta(kind, pick) {
  return (_args, value) => {
    if (!value || value.ok === false) return { kind: 'error', tool: kind, error: value?.error ?? '未知错误' };
    return { kind, ...pick(value) };
  };
}

function pickPlan(plan) {
  return {
    id: plan.id,
    strategy: plan.strategyLabel,
    strategyLabel: plan.strategyLabel,
    status: plan.status,
    statusLabel: plan.statusLabel,
    feasible: plan.feasible,
    score: plan.score,
    startAt: plan.startAt,
    endAt: plan.endAt,
    startLabel: plan.startLabel,
    endLabel: plan.endLabel,
    dueLabel: plan.dueLabel,
    dueMarginHours: plan.dueMarginHours,
    resources: plan.resources,
    segments: plan.segments,
    risks: plan.risks,
    evaluations: plan.evaluations,
    rationale: plan.rationale,
    scoreBreakdown: plan.scoreBreakdown,
  };
}

function renderOverview(value) {
  const stats = value.stats ?? {};
  const lines = [
    `LIMS 概览（演示时钟 ${value.clock?.dateLabel ?? ''}）`,
    `任务 ${stats.totalTasks ?? 0}，紧急 ${stats.urgentTasks ?? 0}，高风险 ${stats.riskTasks ?? 0}，待审核 ${stats.reviewTasks ?? 0}`,
    `设备可用 ${stats.equipmentAvailable ?? 0}/${stats.equipmentTotal ?? 0}，14 天综合利用率 ${stats.equipmentUtilization ?? 0}%`,
  ];
  if (value.alerts?.length) {
    lines.push('需要关注：');
    for (const alert of value.alerts.slice(0, 4)) lines.push(`- ${alert.title}：${alert.detail}`);
  }
  lines.push('右侧边栏已显示同一份数据。');
  return lines.join('\n');
}

function renderTaskList(value) {
  const lines = [`任务列表（${value.total ?? 0}）`];
  for (const task of value.tasks ?? []) {
    lines.push(`- ${task.id} ${task.name}｜${task.priority}｜交期 ${task.dueLabel}｜${task.effortHours}h｜${task.readiness === 'needs_review' ? '需方法审核' : '可排程'}`);
  }
  return lines.join('\n');
}

function renderTask(value) {
  const task = value.task ?? {};
  const lines = [
    `${task.id} ${task.name}`,
    `项目：${task.projectName ?? '—'}（${task.projectCode ?? '—'}）`,
    `优先级：${task.priority}｜交期：${task.dueLabel}｜预计工作量：${task.effortHours}h｜状态：${task.status}`,
    `资质：${(task.qualifications ?? []).join('、') || '—'}`,
    `设备：${(task.equipmentIds ?? []).join('、') || task.equipmentType || '—'}｜空间：${(task.spaceIds ?? []).join('、') || '—'}`,
  ];
  if (task.review) lines.push('注意：非标准方法，需完成方法/资质审核后才能确认。');
  lines.push('候选设备：');
  for (const item of value.candidates?.equipment ?? []) {
    lines.push(`- ${item.id} ${item.name}（${item.status}）${item.usable ? '可用' : `不可用：${item.reasons.join('；')}`}`);
  }
  lines.push('候选人员：');
  for (const item of value.candidates?.persons ?? []) {
    lines.push(`- ${item.id} ${item.name}${item.missing?.length ? `（缺少 ${item.missing.join('、')}）` : ''}`);
  }
  return lines.join('\n');
}

function renderPlans(value) {
  if (value.ok === false) return `排程失败：${value.error}`;
  const lines = [`任务 ${value.task?.id} ${value.task?.name}`];
  if (!value.plans?.length) {
    lines.push('没有可行方案。');
    for (const item of value.diagnostics ?? []) lines.push(`- ${item.text}`);
  } else {
    lines.push(`已生成 ${value.plans.length} 个候选方案，右侧边栏已切换到「排程」页：`);
    for (const plan of value.plans) {
      lines.push(
        `- ${plan.id} ${plan.strategyLabel}｜${plan.statusLabel}｜${plan.score} 分｜${plan.resources.equipment.name} + ${plan.resources.person.name}${plan.resources.space ? ` + ${plan.resources.space.name}` : ''}`,
      );
      lines.push(`  预计 ${plan.startLabel || plan.startAt} → ${plan.endLabel || plan.endAt}｜交期余量 ${plan.dueMarginHours}h`);
      for (const risk of plan.risks ?? []) lines.push(`  风险：${risk.text}`);
    }
    lines.push('请让用户比较方案后在右侧确认；不要在未确认前说已经写入排程。');
  }
  return lines.join('\n');
}

function renderRevision(value) {
  if (value.ok === false) return `重排失败：${value.error}`;
  const comparison = value.comparison;
  const lines = [];
  if (!comparison) {
    lines.push(`已按新条件为 ${value.task?.id} ${value.task?.name} 生成 ${value.plans?.length ?? 0} 个候选方案。`);
    for (const plan of value.plans ?? []) lines.push(`- ${plan.id} ${plan.strategyLabel}｜${plan.statusLabel}｜${plan.score} 分｜${plan.startLabel} → ${plan.endLabel}`);
    lines.push('右侧边栏已切到「排程」页。');
    return lines.join('\n');
  }
  const before = comparison.before;
  const after = comparison.after;
  lines.push(`重排完成：${value.task?.id} ${value.task?.name}`);
  lines.push(`变更前：${before?.startLabel} → ${before?.endLabel}｜${before?.resources?.equipment?.name} + ${before?.resources?.person?.name}｜${before?.score} 分`);
  if (after) {
    lines.push(`变更后：${after.startLabel} → ${after.endLabel}｜${after.resources?.equipment?.name} + ${after.resources?.person?.name}｜${after.score} 分`);
  } else {
    lines.push('变更后：没有找到满足全部约束的方案。');
  }
  const delta = comparison.completionDeltaHours;
  if (delta !== null) lines.push(`完成时间变化：${delta > 0 ? '+' : ''}${delta}h；评分变化：${comparison.scoreDelta > 0 ? '+' : ''}${comparison.scoreDelta}；交期余量变化：${comparison.dueMarginDelta > 0 ? '+' : ''}${comparison.dueMarginDelta}h`);
  if (comparison.lateAfter === true) lines.push('注意：新方案晚于交期。');
  if (comparison.resourceChanges?.length) {
    lines.push('资源变化：');
    for (const change of comparison.resourceChanges) lines.push(`- ${change.label}：${change.from || '—'} → ${change.to || '—'}`);
  }
  if (comparison.daysAdded?.length) lines.push(`新增执行日：${comparison.daysAdded.join('、')}`);
  if (comparison.daysRemoved?.length) lines.push(`移除执行日：${comparison.daysRemoved.join('、')}`);
  if (comparison.risksAdded?.length) lines.push(`新增风险：${comparison.risksAdded.join('；')}`);
  if (comparison.risksRemoved?.length) lines.push(`消除风险：${comparison.risksRemoved.join('；')}`);
  lines.push('右侧边栏已显示前后对比；旧方案已标记为“已替代”，确认只对最新方案生效。');
  return lines.join('\n');
}

function renderConfirm(value) {
  if (value.ok === false) {
    return `无法确认：${value.error}${value.conflicts ? `\n- ${value.conflicts.join('\n- ')}` : ''}`;
  }
  return `已模拟确认 ${value.plan?.id}：${value.plan?.resources?.equipment?.name} + ${value.plan?.resources?.person?.name}。原型更新了资源占用与审计，但没有写入生产系统。`;
}

function renderExplain(value) {
  if (value.ok === false) return `无法解释：${value.error}`;
  const lines = [`${value.resource.name}（${value.resource.type}，${value.resource.status}）`];
  lines.push(value.usable ? '结论：当前可用。' : '结论：当前不可用。');
  for (const reason of value.reasons ?? []) lines.push(`- ${reason}`);
  if (value.alternatives?.length) {
    lines.push('同类型替代设备：');
    for (const item of value.alternatives) lines.push(`- ${item.id} ${item.name}（${item.status}）${item.note ?? ''}`);
  }
  return lines.join('\n');
}

function renderAnalytics(value) {
  const summary = value.summary ?? {};
  const lines = [
    `过去/未来 ${value.windowDays} 天资源分析`,
    `综合设备利用率 ${summary.equipmentUtilization ?? 0}%｜高风险任务 ${summary.tasksAtRisk ?? 0}｜不可用设备 ${summary.blockedEquipment ?? 0}`,
  ];
  if (value.bottleneck) lines.push(`主要瓶颈：${value.bottleneck.text}`);
  if (value.riskTasks?.length) {
    lines.push('风险任务：');
    for (const task of value.riskTasks.slice(0, 5)) lines.push(`- ${task.id} ${task.name}｜${task.priority}｜${task.daysLeft} 天后到期｜负载 ${task.loadPct}%`);
  }
  lines.push('右侧边栏已切换到「分析」页。');
  return lines.join('\n');
}

function renderSimulate(value) {
  const scenario = value.scenario ?? {};
  return [
    `情景模拟：未来 ${scenario.windowDays} 天增加 ${scenario.addCount} 台 ${scenario.equipmentType}`,
    `新增产能 ${scenario.extraCapacity}h；受影响任务 ${scenario.affectedTasks} 个；估算延期风险 ${scenario.delayRiskBefore} → ${scenario.delayRiskAfter}`,
    scenario.note,
  ].join('\n');
}

function renderDowntime(value) {
  if (value.ok === false) return `停机分析失败：${value.error}`;
  const impact = value.impact;
  if (!impact?.found) return '没有找到该设备。';
  const lines = [
    `停机影响：${impact.equipment.name}（${impact.equipment.id}）在 ${impact.dateLabel}（${impact.reason || '计划维护'}）`,
    `受影响任务 ${impact.summary.affected} 个；可重排 ${impact.summary.replannable} 个；完成推迟 ${impact.summary.delayed} 个；晚于交期 ${impact.summary.late} 个；阻塞 ${impact.summary.blocked} 个。`,
  ];
  if (impact.tasks.length === 0) {
    lines.push('该日期没有已排任务受影响。');
  } else {
    for (const entry of impact.tasks) {
      lines.push(`- ${entry.task.id} ${entry.task.name}｜${entry.severity}`);
      lines.push(`  原计划 ${entry.before.startLabel} → ${entry.before.endLabel}`);
      if (entry.recommended) {
        lines.push(`  建议 ${entry.recommended.startLabel} → ${entry.recommended.endLabel}｜${entry.recommended.resources.equipment.name} + ${entry.recommended.resources.person.name}`);
        lines.push(`  执行日 ${entry.recommended.segments.map((segment) => `${segment.day.slice(5)}(${segment.hours}h)`).join('、')}`);
        if (entry.deltaHours > 0) lines.push(`  完成时间推迟约 ${entry.deltaHours}h${entry.late ? '，并晚于交期' : ''}`);
      } else {
        lines.push(`  无法重排：${entry.diagnostics.map((item) => item.text).join('；')}`);
      }
    }
  }
  lines.push('右侧边栏已切换到「影响」页；确认建议前请重新校验资源状态。');
  return lines.join('\n');
}

function renderProjects(value) {
  const lines = [`项目（${value.projects?.length ?? 0}）`];
  for (const project of value.projects ?? []) {
    lines.push(`- ${project.id} ${project.name}｜${project.taskCount} 个任务｜${project.effortHours}h｜交期 ${project.dueFromLabel}–${project.dueToLabel}`);
    lines.push(`  模板：${(project.templateNames ?? []).join('、') || '—'}｜风险 ${project.riskCount}｜测试计划 ${project.testPlanCount}`);
  }
  return lines.join('\n');
}

function renderProject(value) {
  const project = value.project ?? {};
  const lines = [
    `${project.id} ${project.name}`,
    `任务 ${project.taskCount} 个｜总工作量 ${project.effortHours}h｜交期 ${project.dueFromLabel}–${project.dueToLabel}｜待审核 ${project.reviewCount}`,
  ];
  for (const group of value.groups ?? []) {
    lines.push(`模板分组：${group.templateName}（${group.methodCode}），${group.tasks.length} 个任务，${group.effortHours}h`);
    for (const task of group.tasks) {
      lines.push(`- ${task.id} ${task.name}｜${task.priority}｜${task.dueLabel}｜${task.effortHours}h｜${task.review ? '需审核' : '可排程'}`);
    }
  }
  if ((value.testPlans ?? []).length > 0) {
    lines.push('已有测试计划：');
    for (const plan of value.testPlans) lines.push(`- ${plan.id} ${plan.templateName}｜${plan.summary?.scheduled ?? 0}/${plan.summary?.taskCount ?? 0} 已排｜${plan.startLabel} → ${plan.endLabel}`);
  }
  return lines.join('\n');
}

function renderTestPlan(value) {
  if (value.ok === false) return `生成测试计划失败：${value.error}`;
  const plan = value.testPlan;
  if (!plan) return `没有可排任务：${(value.diagnostics ?? []).map((item) => item.text).join('；')}`;
  const lines = [
    `测试计划：${plan.projectName} / ${plan.templateName}`,
    `任务 ${plan.summary.scheduled}/${plan.summary.taskCount} 已排｜${plan.totalHours}h｜${plan.startLabel} → ${plan.endLabel}`,
    `晚于交期 ${plan.summary.late} 项｜阻塞 ${plan.summary.unscheduled} 项｜待审核 ${plan.summary.review} 项`,
  ];
  for (const item of plan.timeline?.rows ?? []) {
    const days = item.segments.map((segment) => `${segment.day.slice(5)} ${segment.start}-${segment.end}`).join('、');
    lines.push(`- ${item.taskId} ${item.name}｜${days}`);
  }
  lines.push('右侧边栏已切到「项目」页。');
  return lines.join('\n');
}

function renderBookings(value) {
  if (value.ok === false) return `查询失败：${value.error}`;
  const lines = [
    `${value.equipment.name}（${value.equipment.id}）在 ${value.dateLabel} 有 ${value.count} 个预约。`,
    `占用 ${value.totalHours}h / 容量 ${value.capacity}h（${value.utilization}%）${value.downtime ? '；该日已登记停机' : ''}`,
  ];
  for (const task of value.tasks ?? []) {
    lines.push(`- ${task.id} ${task.name}｜${task.hours}h｜${task.personNames.join('、') || '—'}`);
  }
  lines.push('聊天窗口会以卡片形式展示这组数字。');
  return lines.join('\n');
}

export function buildTools(store, routes) {
  const call = async (path, body) => {
    const [pathname, query] = path.split('?');
    const method = body ? 'POST' : 'GET';
    const route = routes.find((entry) => entry.path === pathname && entry.methods.includes(method));
    if (!route) throw new Error(`内部路由缺失：${method} ${pathname}`);
    const url = `http://agentic-lims.local${pathname}${query ? `?${query}` : ''}`;
    const init = body
      ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { method };
    const response = await route.fetch(new Request(url, init));
    const data = await response.json();
    return { status: response.status, data };
  };

  return [
    {
      name: 'lims_overview',
      description:
        '查看智能实验室 LIMS 的当日概览：任务数、紧急任务、设备状态、高风险任务和需要关注的告警。用户问“今天实验室怎么样/有什么风险”时先调用它。右侧边栏会显示同一份数据。',
      parameters: schema({}, []),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderOverview(value)),
        presentationMeta: withMeta('overview', (value) => ({
          clock: value.clock,
          stats: value.stats,
          alerts: (value.alerts ?? []).slice(0, 3),
          tasks: (value.tasks ?? []).slice(0, 4),
        })),
      },
      async execute() {
        const { data } = await call('/api/lims/overview');
        await call('/api/lims/focus', { page: 'dashboard', message: 'Agent 正在查看实验室概览。', actor: 'agent' });
        return data;
      },
    },
    {
      name: 'lims_equipment_bookings',
      description:
        '查询某台设备某一天有多少个预约（任务）、占用多少小时、人员是谁。用户问“周三 EQ-007 有多少个预约/占用多久”这类简单数字问题时必须先调用本工具，不要在聊天里估算。',
      parameters: schema(
        {
          equipmentId: { type: 'string', description: '设备 ID，例如 EQ-007' },
          date: { type: 'string', description: '日期 YYYY-MM-DD，例如 2026-10-28' },
        },
        ['equipmentId', 'date'],
      ),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderBookings(value)),
        presentationMeta: withMeta('bookings', (value) => ({
          equipment: value.equipment,
          date: value.date,
          dateLabel: value.dateLabel,
          count: value.count,
          totalHours: value.totalHours,
          capacity: value.capacity,
          utilization: value.utilization,
          downtime: value.downtime,
          tasks: value.tasks,
        })),
      },
      async execute(args) {
        const { data } = await call(`/api/lims/bookings?equipmentId=${encodeURIComponent(args.equipmentId)}&date=${encodeURIComponent(args.date)}`);
        return data;
      },
    },
    {
      name: 'lims_list_projects',
      description:
        '列出实验室项目及其任务数、总工作量、交期范围、模板分组和测试计划数量。用户问“有哪些项目/项目进度”时调用。',
      parameters: schema({}, []),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderProjects(value)),
        presentationMeta: withMeta('projects', (value) => ({ projects: (value.projects ?? []).slice(0, 6) })),
      },
      async execute() {
        const { data } = await call('/api/lims/projects');
        await call('/api/lims/focus', { page: 'projects', message: 'Agent 正在浏览项目。', actor: 'agent' });
        return data;
      },
    },
    {
      name: 'lims_get_project',
      description:
        '读取一个项目的完整结构：项目信息、按模板分组的任务、每个任务的工作量与交期、已有测试计划。用户问某个项目下有哪些任务时调用。',
      parameters: schema({ projectId: { type: 'string', description: '项目 ID，例如 PRJ-1001' } }, ['projectId']),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderProject(value)),
        presentationMeta: withMeta('project', (value) => ({
          project: value.project,
          groups: (value.groups ?? []).map((group) => ({ ...group, tasks: group.tasks.slice(0, 6) })),
          testPlans: (value.testPlans ?? []).slice(0, 3),
        })),
      },
      async execute(args) {
        const { data } = await call(`/api/lims/project?projectId=${encodeURIComponent(args.projectId)}`);
        if (data.ok !== false) await call('/api/lims/focus', { page: 'projects', message: `Agent 正在查看项目 ${args.projectId}。`, actor: 'agent' });
        return data;
      },
    },
    {
      name: 'lims_generate_test_plan',
      description:
        '把一个项目下某个模板分组的多个任务排成一个测试计划（test plan），按优先级和交期顺序运行确定性引擎，并自动避开前面任务已占用的资源。用户说“把项目的这些任务排成一个测试计划”时调用。',
      parameters: schema(
        {
          projectId: { type: 'string', description: '项目 ID，例如 PRJ-1001' },
          templateId: { type: 'string', description: '可选：模板分组 ID（lims_get_project 返回的 group.templateId 或 custom）；省略则排整个项目' },
        },
        ['projectId'],
      ),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderTestPlan(value)),
        presentationMeta: withMeta('testplan', (value) => ({ testPlan: value.testPlan, diagnostics: value.diagnostics })),
      },
      async execute(args) {
        const { data } = await call('/api/lims/test-plan', {
          projectId: args.projectId,
          templateId: args.templateId,
          actor: 'agent',
        });
        return data;
      },
    },
    {
      name: 'lims_list_tasks',
      description:
        '列出实验室测试任务，可按优先级或状态过滤。返回任务 ID、交期、工作量、资质和设备要求。需要 taskId 时先用它定位。',
      parameters: schema(
        {
          priority: { type: 'string', enum: ['Urgent', 'High', 'Normal', 'Low'], description: '可选：按优先级过滤' },
          limit: { type: 'integer', description: '可选：最多返回多少条，默认 10' },
        },
        [],
      ),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderTaskList(value)),
        presentationMeta: withMeta('tasks', (value) => ({ total: value.total, tasks: (value.tasks ?? []).slice(0, 6) })),
      },
      async execute(args) {
        const { data } = await call('/api/lims/tasks');
        await call('/api/lims/focus', { page: 'tasks', message: 'Agent 正在浏览任务列表。', actor: 'agent' });
        let tasks = data.tasks ?? [];
        if (args.priority) tasks = tasks.filter((task) => task.priority === args.priority);
        tasks = tasks.slice(0, Number(args.limit) || 10);
        return { ok: true, total: tasks.length, tasks };
      },
    },
    {
      name: 'lims_get_task',
      description:
        '读取一个测试任务的完整上下文：项目、交期、资质与设备要求、候选设备/人员/空间、当前负荷和历史执行记录。在生成排程之前调用它确认约束。',
      parameters: schema({ taskId: { type: 'string', description: '任务 ID，例如 TASK-2005' } }, ['taskId']),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderTask(value)),
        presentationMeta: withMeta('task', (value) => ({
          task: value.task,
          candidates: {
            equipment: (value.candidates?.equipment ?? []).slice(0, 4),
            persons: (value.candidates?.persons ?? []).slice(0, 4),
          },
        })),
      },
      async execute(args) {
        const { data } = await call(`/api/lims/task?taskId=${encodeURIComponent(args.taskId)}`);
        if (data.ok !== false) {
          await call('/api/lims/focus', { page: 'task', taskId: args.taskId, message: `Agent 正在查看 ${args.taskId}。`, actor: 'agent' });
        }
        return data;
      },
    },
    {
      name: 'lims_generate_plans',
      description:
        '为指定任务运行确定性排程引擎，生成 1-5 个满足硬约束的候选方案，并自动把右侧边栏切换到「排程」页展示甘特图、约束校验和方案对比。不要自己编造时间或设备组合，必须使用本工具的结果。',
      parameters: schema(
        {
          taskId: { type: 'string', description: '任务 ID' },
          count: { type: 'integer', description: '候选方案数量，默认 3' },
          avoidFridayAfternoon: { type: 'boolean', description: '可选：周五下午不安排实验' },
          preferredEquipmentId: { type: 'string', description: '可选：优先使用的设备 ID，例如 EQ-003' },
        },
        ['taskId'],
      ),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderPlans(value)),
        presentationMeta: withMeta('plans', (value) => ({
          task: value.task,
          plans: (value.plans ?? []).map((plan) => ({
            id: plan.id,
            strategyLabel: plan.strategyLabel,
            status: plan.status,
            statusLabel: plan.statusLabel,
            score: plan.score,
            startLabel: plan.startLabel,
            endLabel: plan.endLabel,
            dueMarginHours: plan.dueMarginHours,
            resources: plan.resources,
            risks: (plan.risks ?? []).slice(0, 2),
          })),
          diagnostics: value.diagnostics,
        })),
      },
      async execute(args) {
        const { data } = await call('/api/lims/plans', {
          taskId: args.taskId,
          count: args.count,
          avoidFridayAfternoon: args.avoidFridayAfternoon,
          preferredEquipmentId: args.preferredEquipmentId,
          actor: 'agent',
        });
        if (!data.plans) return data;
        return {
          ok: true,
          task: data.task,
          plans: data.plans.map(pickPlan),
          diagnostics: data.diagnostics,
          excluded: data.excluded,
          workspace: data.workspace ? { page: data.workspace.page, revision: data.workspace.revision } : null,
        };
      },
    },
    {
      name: 'lims_revise_plan',
      description:
        '在已有候选方案基础上修改排程约束（如周五下午不排、优先设备/人员、最早开始日期）并重新运行确定性引擎，返回变更前后对比。用户说“重新安排/换个条件/优先设备 A/周五下午不要排”时调用。右侧边栏会显示对比卡片。',
      parameters: schema(
        {
          taskId: { type: 'string', description: '任务 ID，例如 TASK-2005' },
          previousPlanId: { type: 'string', description: '可选：要对比的旧方案 ID；省略则只生成新方案，不产生前后对比' },
          avoidFridayAfternoon: { type: 'boolean', description: '可选：周五下午不安排实验' },
          preferredEquipmentId: { type: 'string', description: '可选：优先使用的设备 ID' },
          preferredPersonId: { type: 'string', description: '可选：优先使用的人员 ID' },
          earliestStart: { type: 'string', description: '可选：最早开始日期 YYYY-MM-DD' },
        },
        ['taskId'],
      ),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderRevision(value)),
        presentationMeta: withMeta('revision', (value) => ({ task: value.task, comparison: value.comparison })),
      },
      async execute(args) {
        const { data } = await call('/api/lims/plans', {
          taskId: args.taskId,
          previousPlanId: args.previousPlanId,
          avoidFridayAfternoon: args.avoidFridayAfternoon,
          preferredEquipmentId: args.preferredEquipmentId,
          preferredPersonId: args.preferredPersonId,
          earliestStart: args.earliestStart,
          actor: 'agent',
        });
        return data;
      },
    },
    {
      name: 'lims_confirm_plan',
      description:
        '模拟确认一个候选排程方案。会重新校验设备状态、人员容量和时间冲突，写入原型的资源占用与审计记录；不会写入生产系统。用户明确说“确认/采用方案 X”后才调用。',
      parameters: schema(
        {
          planId: { type: 'string', description: '候选方案 ID，以 lims_generate_plans / lims_revise_plan 返回值为准' },
        },
        ['planId'],
      ),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderConfirm(value)),
        presentationMeta: withMeta('confirm', (value) => ({ plan: value.plan, simulated: value.simulated })),
      },
      async execute(args) {
        const { data } = await call('/api/lims/confirm', { planId: args.planId, actor: 'agent' });
        return data;
      },
    },
    {
      name: 'lims_analyze_downtime',
      description:
        '登记某台设备在某一天的计划停机（维护/校准），分析受影响的已排任务，并用确定性引擎给出替代资源和重排建议。用户说“设备 X 明天维护/停机，哪些任务受影响”时调用。会把右侧边栏切到「影响」页。',
      parameters: schema(
        {
          equipmentId: { type: 'string', description: '设备 ID，例如 EQ-007' },
          date: { type: 'string', description: '停机日期，格式 YYYY-MM-DD，例如 2026-10-28' },
          reason: { type: 'string', description: '可选：停机原因，例如 计划维护 / 校准' },
        },
        ['equipmentId', 'date'],
      ),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderDowntime(value)),
        presentationMeta: withMeta('downtime', (value) => ({ impact: value.impact })),
      },
      async execute(args) {
        const { data } = await call('/api/lims/downtime', {
          equipmentId: args.equipmentId,
          date: args.date,
          reason: args.reason,
          actor: 'agent',
        });
        if (data.ok !== false && data.impact) {
          return {
            ok: true,
            downtime: data.downtime,
            impact: {
              found: true,
              equipment: data.impact.equipment,
              date: data.impact.date,
              dateLabel: data.impact.dateLabel,
              reason: data.impact.reason,
              summary: data.impact.summary,
              tasks: data.impact.tasks,
            },
            workspace: data.workspace ? { page: data.workspace.page, revision: data.workspace.revision } : null,
          };
        }
        return data;
      },
    },
    {
      name: 'lims_explain_resource',
      description:
        '解释某台设备或空间为什么可用/不可用，并给出同类型替代资源。用户问“为什么不能用 EQ-004”“有什么替代设备”时调用。校准、维护、状态、类型和时间冲突必须来自本工具，不要凭设备名称猜测。',
      parameters: schema(
        {
          resourceId: { type: 'string', description: '资源 ID，例如 EQ-004 或 SP-001' },
          taskId: { type: 'string', description: '可选：关联任务 ID，用于检查任务特定约束' },
        },
        ['resourceId'],
      ),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderExplain(value)),
        presentationMeta: withMeta('resource', (value) => ({
          resource: value.resource,
          usable: value.usable,
          reasons: value.reasons,
          alternatives: (value.alternatives ?? []).slice(0, 4),
        })),
      },
      async execute(args) {
        const { data } = await call('/api/lims/explain', { resourceId: args.resourceId, taskId: args.taskId, actor: 'agent' });
        return data;
      },
    },
    {
      name: 'lims_analyze_bottlenecks',
      description:
        '分析未来 14 天的设备利用率、人员负荷、交期风险和主要瓶颈。用户问“瓶颈在哪里/哪些项目会延期/资源利用率”时调用。右侧边栏会切换到「分析」页。',
      parameters: schema({}, []),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderAnalytics(value)),
        presentationMeta: withMeta('analytics', (value) => ({
          windowDays: value.windowDays,
          summary: value.summary,
          bottleneck: value.bottleneck,
          riskTasks: (value.riskTasks ?? []).slice(0, 4),
        })),
      },
      async execute() {
        const { data } = await call('/api/lims/analytics');
        await call('/api/lims/focus', { page: 'analytics', message: 'Agent 正在分析资源瓶颈。', actor: 'agent' });
        return data;
      },
    },
    {
      name: 'lims_simulate_capacity',
      description:
        '情景模拟：如果增加设备，能减少多少延期风险。按 14 天窗口做示意性产能估算，结果必须说明是估算、未重新求解全部排程。',
      parameters: schema(
        {
          equipmentType: { type: 'string', description: '设备类型，例如 HPLC、GC-FID、Universal Tester、Climate Chamber' },
          addCount: { type: 'integer', description: '新增设备数量，默认 1' },
        },
        ['equipmentType'],
      ),
      output: {
        ...OUTPUT,
        render: (_args, value) => text(renderSimulate(value)),
        presentationMeta: withMeta('simulate', (value) => ({ scenario: value.scenario })),
      },
      async execute(args) {
        const { data } = await call('/api/lims/simulate', {
          equipmentType: args.equipmentType,
          addCount: args.addCount,
          actor: 'agent',
        });
        return data;
      },
    },
  ];
}
