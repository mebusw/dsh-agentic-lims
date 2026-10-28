/**
 * Request -> task draft helpers. These are intentionally read-only until the
 * user explicitly confirms: a vague request is mapped to existing tasks or to
 * structured draft fields, then a separate call persists the drafts.
 */
import { addDays, dateKey, formatDate, round1 } from './util.js';

const PRIORITIES = new Set(['Urgent', 'High', 'Normal', 'Low']);

function words(value) {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .filter((word) => word.length > 1);
}

function scoreText(text, haystack) {
  const tokens = words(text);
  let score = 0;
  for (const token of tokens) if (haystack.includes(token)) score += 1;
  return { score, tokens };
}

function matchConfidence(score) {
  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return score > 0 ? 'low' : 'none';
}

function inferTemplate(domain, requestText, templateId) {
  if (templateId) return domain.templateById.get(templateId) ?? null;
  let best = null;
  let bestScore = 0;
  for (const template of domain.templates) {
    const haystack = [template.name, template.methodCode, template.requiredEquipmentType, ...(template.requiredQualification ?? [])].join(' ').toLowerCase();
    const { score } = scoreText(requestText, haystack);
    if (score > bestScore) {
      best = template;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function projectDueDate(project, domain) {
  const dates = project.taskIds.map((id) => domain.taskById.get(id)?.dueDate).filter(Boolean);
  return dates.length > 0 ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;
}

export function prepareTaskDrafts(domain, projectId, options = {}) {
  const project = domain.projects.find((item) => item.id === projectId);
  if (!project) return { found: false, projectId, error: `找不到项目 ${projectId}` };
  const requestText = String(options.requestText ?? '').trim();
  const template = inferTemplate(domain, `${requestText} ${options.name ?? ''} ${options.method ?? ''}`, options.templateId);
  const projectTasks = project.taskIds.map((id) => domain.taskById.get(id)).filter(Boolean);
  const matches = projectTasks
    .map((task) => {
      const haystack = [task.name, task.method, task.template?.name, task.template?.methodCode, task.templateId].join(' ').toLowerCase();
      let score = scoreText(requestText, haystack).score;
      if (options.templateId && task.templateId === options.templateId) score += 2;
      if (requestText && requestText.toLowerCase().includes(task.id.toLowerCase())) score += 5;
      return {
        taskId: task.id,
        name: task.name,
        templateId: task.templateId,
        templateName: task.template?.name ?? null,
        priority: task.priority,
        dueLabel: formatDate(task.dueDate, true),
        effortHours: task.effortHours,
        confidence: matchConfidence(score),
        score,
        reason: score > 0 ? `request 与任务名称/方法/模板有 ${score} 个词匹配` : '未匹配',
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const latestDue = projectDueDate(project, domain);
  const dueDate = options.dueDate ? dateKey(options.dueDate) : dateKey(latestDue ?? addDays(new Date(), 7));
  const estimatedDue = !options.dueDate;
  const baseMinutes = (template?.prepMinutes ?? 60) + (template?.testMinutes ?? 120);
  const effortHours = options.effortHours != null ? Number(options.effortHours) : round1(Math.max(1, baseMinutes / 60));
  const estimatedEffort = options.effortHours == null;
  const priority = PRIORITIES.has(options.priority) ? options.priority : 'Normal';
  const requestedStart = options.requestedStart ? dateKey(options.requestedStart) : dateKey(new Date());
  const missing = [];
  if (!template) missing.push('未确定模板，需要人工指定 templateId');
  if (estimatedDue) missing.push('未提供交期，暂用项目最晚交期');
  if (estimatedEffort) missing.push('未提供工时，暂用模板准备+测试时长估算');
  if (!options.requestId) missing.push('未关联 request_id');
  const draft = {
    draftId: `DRAFT-${Date.now().toString(36).toUpperCase()}`,
    projectId: project.id,
    projectName: project.name,
    name: options.name || (template ? `${template.name} 任务` : requestText || '新任务'),
    method: options.method || template?.name || requestText || '待确认方法',
    templateId: template?.id ?? null,
    templateName: template?.name ?? null,
    methodCode: template?.methodCode ?? null,
    priority,
    requestedStart,
    dueDate,
    effortHours,
    elapsedDays: options.elapsedDays != null ? Number(options.elapsedDays) : 1,
    qualifications: options.qualifications ?? template?.requiredQualification ?? [],
    equipmentIds: options.equipmentIds ?? [],
    spaceIds: options.spaceIds ?? (template?.requiredSpaceId ? [template.requiredSpaceId] : []),
    requestId: options.requestId ?? null,
    estimatedDue,
    estimatedEffort,
    missing,
    confidence: template && !estimatedDue && !estimatedEffort ? 'high' : template ? 'medium' : 'low',
    basis: template ? `项目 ${project.id} + 模板 ${template.id}（${template.name}）` : `项目 ${project.id}，模板待确认`,
  };
  const hasHigh = matches.some((item) => item.confidence === 'high');
  const hasMedium = matches.some((item) => item.confidence === 'medium');
  const recommendation = hasHigh ? 'use_existing' : hasMedium ? 'needs_confirmation' : template ? 'create_draft' : 'needs_confirmation';
  return {
    found: true,
    project: { id: project.id, name: project.name, code: project.code, taskCount: project.taskIds.length },
    requestText,
    template: template
      ? { id: template.id, name: template.name, methodCode: template.methodCode, requiredEquipmentType: template.requiredEquipmentType, requiredQualification: template.requiredQualification, requiredSpaceId: template.requiredSpaceId }
      : null,
    matches,
    drafts: [draft],
    recommendation,
    note: '这是只读拆解，尚未写入任务；确认后再调用 lims_create_task_draft。',
  };
}

export async function createTaskDrafts(db, domain, projectId, drafts, actor = 'agent') {
  const project = domain.projects.find((item) => item.id === projectId);
  if (!project) return { ok: false, error: `找不到项目 ${projectId}` };
  if (!Array.isArray(drafts) || drafts.length === 0) return { ok: false, error: '没有可创建的任务草稿' };
  const created = [];
  const stamp = `${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  for (const [index, draft] of drafts.entries()) {
    const template = domain.templateById.get(draft.templateId);
    if (!template) return { ok: false, error: `草稿 ${index + 1} 的模板 ${draft.templateId} 不存在` };
    const name = String(draft.name ?? '').trim();
    if (!name) return { ok: false, error: `草稿 ${index + 1} 缺少任务名称` };
    const dueDate = draft.dueDate ? dateKey(draft.dueDate) : null;
    if (!dueDate) return { ok: false, error: `草稿 ${index + 1} 缺少交期` };
    const effortHours = Number(draft.effortHours);
    if (!Number.isFinite(effortHours) || effortHours <= 0) return { ok: false, error: `草稿 ${index + 1} 的工作量必须大于 0` };
    const taskId = `TASK-DEMO-${stamp}${index + 1}`;
    const doc = {
      task_id: taskId,
      project_id: project.id,
      project_name: project.name,
      project_code: project.code,
      test_no: `DRAFT-${taskId}`,
      task_name: name,
      test_method: draft.method || template.name,
      priority: PRIORITIES.has(draft.priority) ? draft.priority : 'Normal',
      requested_start: draft.requestedStart ? dateKey(draft.requestedStart) : dateKey(new Date()),
      due_date: dueDate,
      estimated_effort_hours: effortHours,
      estimated_elapsed_days: Number(draft.elapsedDays) > 0 ? Number(draft.elapsedDays) : 1,
      required_qualifications: (draft.qualifications ?? template.requiredQualification ?? []).join(';'),
      required_equipment_ids: (draft.equipmentIds ?? []).join(';'),
      required_space_ids: (draft.spaceIds ?? (template.requiredSpaceId ? [template.requiredSpaceId] : [])).join(';'),
      status: 'Ready',
    };
    await db.collection('raw_tasks').insertOne({ _id: taskId, ...doc });
    await db.collection('task_template_overrides').updateOne(
      { _id: taskId },
      { $set: { templateId: template.id, updatedAt: new Date().toISOString(), actor } },
      { upsert: true },
    );
    created.push({
      id: taskId,
      name,
      projectId: project.id,
      templateId: template.id,
      templateName: template.name,
      dueDate,
      effortHours,
      requestId: draft.requestId ?? null,
    });
  }
  return { ok: true, projectId: project.id, created };
}
