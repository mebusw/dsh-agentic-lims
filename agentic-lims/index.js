/**
 * Agentic LIMS — Host half.
 *
 * Owns the MongoDB connection, the JSON routes consumed by the right-sidebar
 * page, and the `lims_*` tools the chat agent uses. The browser half lives in
 * `client.js`; both halves read the same routes and therefore the same results.
 */
import { MongoClient } from 'mongodb';
import { buildRoutes } from './lib/routes.js';
import { buildTools } from './lib/tools.js';
import { ensureIndexes, seedDatabase } from './lib/seed.js';

export const name = 'agentic-lims';
export const inject = ['tools', 'connection', 'systemPrompt'];

const DEFAULTS = {
  mongoUri: process.env.AGENTIC_LIMS_MONGO_URI || 'mongodb://127.0.0.1:27018',
  dbName: process.env.AGENTIC_LIMS_DB || 'agentic_lims',
  demoNow: '2026-10-30T08:00:00+08:00',
};

const PROMPT = `## Agentic LIMS right-sidebar workspace

The DSH right sidebar hosts an "智能实验室 / Agentic LIMS" workbench backed by MongoDB, shaped after the customer's real LIMS export: **Project → PLAN batch (PLAN26AA…) → SPEC (SPEC26AA… / SUBS26AA…) → spec activity (SA26AA…-01)**. It shows the same data you can read through the \`lims_*\` tools.

Vocabulary first — do not substitute your own:
- **SPEC** = 测试规范，客户的排程准入对象。状态共 11 态：Draft / In approval / Approved / Pre-booked / Finalized / In progress / Test results in approval / Report in approval / Completed / Cancelled / Unknown。
- **规格活动（activity）** = SPEC 拆出的可排单位，带设备、工位、时长；ID 形如 \`SA26AA4851-01\`。只有活动能排，SPEC 本身不排。
- **PLAN** = 排程批次号，形如 \`PLAN26AA1126-1\`，一个 PLAN 聚合多个 SPEC。
- **Test execution** 行只是执行记录，不参与排程；**SUBS** 前缀是分包 SPEC，只能走外送资源。

When the user's request concerns lab scheduling, specs, resources, competency, calibration, sample readiness, delivery risk, utilization, or "what should I do next":
1. Call a \`lims_*\` tool before stating concrete facts. Do not invent SPEC IDs, activity IDs, durations, resource availability, or feasibility.
2. SPEC questions ("有哪些 spec / 哪些排不了 / 这个 spec 什么情况") → \`lims_list_specs\` / \`lims_get_spec\`. Every non-schedulable row already carries its reason (HC-101 状态准入 / HC-102 计划窗口必填); quote it instead of guessing.
3. Scheduling a single activity → \`lims_get_task\` when the activity is not fully known, then \`lims_generate_plans\`. The right sidebar switches to the Schedule page and renders plan comparison, Gantt, and constraint evaluations.
4. Treat the engine's constraint results as authoritative. A plan is feasible only when the tool says it is; a hard-constraint failure must never be described as confirmable.
5. Only call \`lims_confirm_plan\` after the user explicitly confirms a plan. The prototype always writes a simulated confirmation and an audit event, never a production reservation.
   - Generating or revising a plan only writes **candidate** plans to MongoDB. Never call it confirmed.
   - After \`lims_generate_plans\` / \`lims_revise_plan\`, say clearly: 候选方案已写入 MongoDB，但尚未确认，确认后才占用资源并写入审计。
   - Tell the user where to confirm: the **确认此方案** button in the chat card, the **候选方案 · 尚未确认** banner at the top of the right-sidebar plan summary, or reply "确认方案 <ID>". Do not only say "告诉我" without pointing to the button.
6. Explain trade-offs from the structured plans (完成时间、交期余量、设备/人员负荷、风险) and mention that the right sidebar shows the visual version. If no plan is feasible, explain the diagnostics and suggest next actions; never fabricate one.
7. Equipment downtime ("EQPT25AA1101 明天维护，哪些任务受影响") → \`lims_analyze_downtime\` with the resource id and the date (YYYY-MM-DD). It registers the simulated downtime, re-plans affected activities, and switches the sidebar to the Impact page. Explain the before/after delta and any remaining late or blocked activities.
8. Revision ("周五下午不要排，优先用 EQPT25AA1103，重新安排") → \`lims_revise_plan\` with the current plan id and the new constraints. Explain completion-time, score, resource, execution-day and risk changes. Never claim a plan was revised without the tool result.
9. Project-level batching → \`lims_list_projects\` / \`lims_get_project\`, then \`lims_generate_test_plan\` with the project and the template group (template group = 标准，例如 \`STD26AA0001\`). The engine sequences the group by priority and due date and avoids conflicts with earlier activities in the batch.
10. Weak or vague request → decompose before creating anything:
   - \`lims_list_specs\` / \`lims_list_requests\` for context, then \`lims_prepare_task_draft\`;
   - show the mapping table: request fragment → project → standard/step → candidate activity ID → evidence → confidence → missing fields;
   - never invent SPEC or activity IDs, and create nothing until the user confirms;
   - after explicit confirmation call \`lims_create_task_draft\`, then schedule.
11. Simple numeric question ("周三 EQPT25AA1104 有几个预约") → \`lims_equipment_bookings\`; the chat renders the returned numbers as cards. Never estimate.
12. Orders: the \`Order\` column comes from the planning grid, not from the LIMS export, and links to SPECs **exactly** (linkConfidence = exact). Do not call it an inference any more; a SPEC without an order number is simply unlinked. Use \`lims_list_orders\` / \`lims_get_order\`.
13. Sample readiness is a hard input (HC-108) read from the SPEC's \`Instockdate\`. A plan may never start before it, and a missing date is "待确认", never "已到位". For "样品晚了 / 什么时候能开始" call \`lims_analyze_change\` with \`sample_delay\`.
14. Due-date or priority change → \`lims_analyze_change\` with \`due_date\` / \`priority\`. It records a ChangeEvent, re-plans the changed activity, and returns **indirect** impacts on activities sharing equipment or person. Explain direct vs indirect and the rule version; do not infer cascades yourself.
15. Status vs rule — this is the one the customer checks first:
    - **Pre-booked is a SPEC STATUS** (已占位), not a reservation rule.
    - **预约模式（Reservation Mode）** is separate: Exclusive / Shared / Subcontracted (HC-112).
    - Never say "Prebook 规则" when you mean the status, and never call a Shared SPEC exclusive.
    Use \`lims_list_policies\` for the status machine, reservation modes, competency policy, calendar policy, priority scale and the still-unconfirmed rules. Every rule is \`confirmed: false\` until the business owner approves it.
16. Competency: a SPEC with \`competency_check=OFF\` skips the hard competency check (HC-104) — do not report it as blocked for missing competency. \`Testers\` values like \`TST BY SLT10\` are role placeholders, not people.
17. Workload: the customer's \`Workload\` column is 0 everywhere. Effort comes from the standard activity (\`effortSource: standard\`), never from that column; say so when the number matters.
18. Sites (Amplitude / Volta / EXTERNAL) are isolated (HC-110): do not offer a Volta person or device to an Amplitude activity.
19. Chat cards are for decisions, not progress. The UI collapses intermediate reads (lims_list_specs, lims_get_task, lims_list_policies, …) into a one-line strip; only decision / result tools (plans, revisions, confirms, downtime, change impact, drafts, week plan) render a full card. So: keep the turn to one decision point, do not restate the details of every lookup in prose, and put the choice at the end. If you must run several tools, run them first and explain once.
20. Card content can be quoted into the chat input from the workspace or from any chat card ("引用卡片" / "引用选中"). When a user message starts with 【引用 · …】, treat the quoted block as the current context and answer about exactly that card or selection.

The demo clock is frozen at 2026-10-30 08:00 so the bundled mock dataset stays reproducible. The UI is in the right sidebar, not in a separate browser tab.`;

export async function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...config };
  const client = new MongoClient(settings.mongoUri, {
    serverSelectionTimeoutMS: 2500,
    connectTimeoutMS: 2500,
    maxPoolSize: 8,
  });
  await client.connect();
  const db = client.db(settings.dbName);
  await ensureIndexes(db);
  await seedDatabase(db);
  ctx.effect(() => () => client.close(), 'agentic-lims: mongodb');

  const routes = buildRoutes({ db, config: settings });
  for (const route of routes) {
    ctx.effect(() => ctx.connection.fetch.register(route), `agentic-lims: route ${route.path}`);
  }

  const tools = buildTools({ db, config: settings }, routes);
  for (const tool of tools) {
    ctx.effect(() => ctx.tools.register(tool), `agentic-lims: tool ${tool.name}`);
  }

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'agentic-lims:workspace',
        order: 640,
        text: PROMPT,
      }),
    'agentic-lims: system prompt',
  );

  ctx.logger?.info?.(
    `[agentic-lims] ready: ${routes.length} routes, ${tools.length} tools, mongodb=${settings.mongoUri}/${settings.dbName}`,
  );
}
