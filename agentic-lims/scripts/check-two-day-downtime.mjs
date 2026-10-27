import { loadRawDataset } from '../lib/csv.js';
import { buildDomain } from '../lib/model.js';
import { createEngineContext, analyzeDowntime } from '../lib/engine.js';
import { parseInstant } from '../lib/util.js';
const domain = buildDomain(await loadRawDataset());
const ctx = createEngineContext(domain, parseInstant('2026-10-27T08:00:00+08:00'), { downtime: [
  { equipmentId: 'EQ-007', date: '2026-10-27' },
  { equipmentId: 'EQ-007', date: '2026-10-28' },
]});
const impact = analyzeDowntime(ctx, 'EQ-007', '2026-10-28', '两日维护');
console.log(impact.summary);
const t = impact.tasks[0];
console.log(t.task.id, 'before', t.before.startLabel, '->', t.before.endLabel);
console.log('after', t.recommended?.startLabel, '->', t.recommended?.endLabel, 'days', t.recommended?.segments.map(s=>s.day), 'delta', t.deltaHours, 'late', t.late);
