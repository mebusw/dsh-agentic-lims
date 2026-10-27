import { loadRawDataset } from '../lib/csv.js';
import { buildDomain } from '../lib/model.js';
import { createEngineContext, generatePlans, explainResource, computeAnalytics, buildOverview } from '../lib/engine.js';
import { parseInstant } from '../lib/util.js';

const raw = await loadRawDataset();
const domain = buildDomain(raw);
const now = parseInstant('2026-10-27T08:00:00+08:00');
const ctx = createEngineContext(domain, now);
console.log('domain', { tasks: domain.tasks.length, equipment: domain.equipment.length, spaces: domain.spaces.length, persons: domain.persons.length, allocations: domain.allocations.length });
for (const task of domain.tasks) {
  const result = generatePlans(ctx, task, { count: 3 });
  console.log('\n', task.id, task.name, '| review', /review/i.test(task.status));
  console.log('  candidates', result.candidates.equipment.map(e => `${e.id}:${e.usable ? 'ok' : e.reasons[0]}`).join(' | '));
  console.log('  persons', result.candidates.persons.map(p => `${p.id}${p.missing.length ? `(missing ${p.missing})` : ''}`).join(' | '));
  for (const plan of result.plans) {
    console.log('  ', plan.id, plan.strategyLabel, plan.status, plan.score, plan.startAt, '->', plan.endAt, 'margin', plan.dueMarginHours, plan.resources.equipment.id, plan.resources.person.id, plan.segments.length);
    console.log('     risks', plan.risks.map(r => r.text).join(' / '));
  }
  if (!result.plans.length) console.log('  diagnostics', result.diagnostics);
}
console.log('\nexplain EQ-004 for TASK-2003');
const explanation = explainResource(ctx, 'EQ-004', 'TASK-2003');
console.log(JSON.stringify(explanation, null, 2).slice(0, 2200));
const analytics = computeAnalytics(domain, ctx, []);
console.log('\nanalytics summary', analytics.summary, analytics.bottleneck);
console.log('overview stats', buildOverview(domain, ctx).stats);
