import { loadRawDataset } from '../lib/csv.js';
import { buildDomain } from '../lib/model.js';
import { createEngineContext, analyzeDowntime, generatePlans } from '../lib/engine.js';
import { parseInstant } from '../lib/util.js';

const raw = await loadRawDataset();
const domain = buildDomain(raw);
const now = parseInstant('2026-10-27T08:00:00+08:00');
const downtime = [{ equipmentId: 'EQ-007', date: '2026-10-27', reason: '计划维护' }];
const ctx = createEngineContext(domain, now, { downtime });
const impact = analyzeDowntime(ctx, 'EQ-007', '2026-10-27', '计划维护');
console.log(JSON.stringify({ found: impact.found, equipment: impact.equipment?.name, date: impact.date, summary: impact.summary }, null, 2));
for (const entry of impact.tasks) {
  console.log('\nTASK', entry.task.id, entry.task.name, entry.severity, 'delta', entry.deltaHours, 'late', entry.late);
  console.log('  before', entry.before.startLabel, '->', entry.before.endLabel, entry.before.segments.map(s => `${s.day}:${s.hours}h`).join(', '));
  console.log('  after ', entry.recommended?.startLabel, '->', entry.recommended?.endLabel);
  console.log('  risks ', (entry.recommended?.risks ?? []).map(r => r.text).join(' / '));
  console.log('  diag  ', entry.diagnostics.map(d => d.text).join(' / '));
}
const empty = analyzeDowntime(ctx, 'EQ-006', '2026-10-27');
console.log('\nEQ-006 impact summary', empty.summary, 'tasks', empty.tasks.length);
