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
  demoNow: '2026-10-27T08:00:00+08:00',
};

const PROMPT = `## Agentic LIMS right-sidebar workspace

The DSH right sidebar hosts an "智能实验室 / Agentic LIMS" workbench backed by MongoDB. It shows the same data you can read through the \`lims_*\` tools.

When the user's request concerns lab tasks, scheduling, resources, qualifications, calibration, delivery risk, utilization, or "what should I do next" in the lab:
1. Call a \`lims_*\` tool before answering with concrete facts. Do not invent task IDs, durations, resource availability, or feasibility.
2. For a scheduling request, call \`lims_get_task\` if the task is not fully known, then \`lims_generate_plans\`. The workspace switches to the Schedule page and renders plan comparison, a Gantt timeline, and constraint evaluations.
3. Treat the engine's constraint results as authoritative. A plan is feasible only when the tool says it is; a hard-constraint failure must never be described as confirmable.
4. Only call \`lims_confirm_plan\` after the user explicitly confirms a plan. The prototype always writes a simulated confirmation and an audit event, never a production reservation.
   - Generating or revising a plan only writes **candidate** plans to MongoDB. Never call it confirmed.
   - After \`lims_generate_plans\` / \`lims_revise_plan\`, say clearly: 候选方案已写入 MongoDB，但尚未确认，确认后才占用资源并写入审计。
   - Tell the user where to confirm: the **确认此方案** button in the chat card, the **候选方案 · 尚未确认** banner at the top of the right-sidebar plan summary, or reply "确认方案 <ID>". Do not only say "告诉我" without pointing to the button.
5. Explain trade-offs from the returned structured plans (completion time, due margin, equipment/person load, risks). Mention that the right sidebar shows the visual version.
6. If there is no feasible plan, explain the diagnostics and suggest concrete next actions; do not fabricate one.
7. For equipment downtime ("EQ-007 明天维护，哪些任务受影响"), call \`lims_analyze_downtime\` with the device and date. It registers the simulated downtime, re-plans affected tasks against the deterministic engine, and switches the right sidebar to the Impact page. Explain the before/after delta and any remaining late or blocked tasks.
8. For a revision ("周五下午不要排，优先用 EQ-005，重新安排"), call \`lims_revise_plan\` with the current plan ID and the new constraints. Explain completion-time, score, resource, execution-day and risk changes from the returned comparison. Never claim a plan was revised without the tool result.
9. Projects contain tasks; a group of tasks under one template can become a test plan. Use \`lims_list_projects\` / \`lims_get_project\` to inspect the structure, then \`lims_generate_test_plan\` with the project and template group. The engine schedules the group in priority order and avoids resource conflicts with earlier tasks in the same batch.
10. If the user gives a vague request, do **request → task decomposition first**:
   - use \`lims_list_requests\` / \`lims_get_project\` for context, then \`lims_prepare_task_draft\`;
   - show the mapping table: request fragment → project → template → candidate TASK_ID → evidence → confidence → missing fields;
   - do not invent task IDs and do not create tasks until the user confirms;
   - after explicit confirmation call \`lims_create_task_draft\`, then schedule with \`lims_generate_test_plan\` / \`lims_generate_plans\`.
11. For a simple numeric question ("周三 EQ-007 有多少个预约"), call the dedicated query tool rather than estimating; the chat renders the returned numbers as cards.
12. Orders and specs are separate from project tasks. Use \`lims_list_orders\` / \`lims_get_order\` when the user asks about a test order, an order's spec, its sample status, or whether it already has tasks. The order → task links are **prototype inferences**; always say they need TL confirmation and show the evidence (\`linkBasis\`), never present them as an established LIMS relationship.
13. Sample readiness is a scheduling input (HC-007). A plan may never start before the sample's actual/expected in-stock time, and "unknown" sample status must be reported as needing confirmation. For "样品晚了/什么时候能开始" call \`lims_analyze_change\` with type \`sample_delay\`.
14. For "交期改到 X / 提前或推迟交期 / 调高优先级" call \`lims_analyze_change\` with type \`due_date\` or \`priority\`. It records a ChangeEvent, re-plans the changed task, and returns **indirect** impacts on tasks sharing the same equipment or person. Explain direct vs indirect impact and the rule version from the result; do not infer cascades yourself.
15. Task Type decides whether a resource may be shared (HC-008): Prebook is exclusive, Test Spec allows sharing up to a configured limit. Use \`lims_list_policies\` when the user asks why a task cannot share a device or which rules are still unconfirmed. Every rule in the payload is marked \`confirmed: false\` until the business owner approves it.
16. Card content can be quoted into the chat input from the workspace or from any chat card ("引用卡片" / "引用选中"). When a user message starts with 【引用 · …】, treat the quoted block as the current context and answer about exactly that card or selection.

The demo clock is frozen at 2026-10-27 08:00 so the bundled mock dataset stays reproducible. The UI is in the right sidebar, not in a separate browser tab.`;

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
