import { MongoClient } from 'mongodb';
import { buildRoutes } from '../lib/routes.js';
const client = await MongoClient.connect('mongodb://127.0.0.1:27018');
const db = client.db('agentic_lims');
const routes = buildRoutes({ db, config: { demoNow: '2026-10-27T08:00:00+08:00' } });
const route = routes.find((r) => r.path === '/api/lims/resource-schedule');
const res = await route.fetch(new Request('http://x/api/lims/resource-schedule?weekStart=2026-10-26'));
const data = await res.json();
console.log(res.status, data.weekLabel, data.summary);
for (const resource of data.resources) {
  console.log(resource.kind, resource.id, resource.name, resource.segments.map((s) => `${s.day} ${s.taskId} ${s.start}-${s.end}`).join(' | '));
}
console.log('plans', data.plans.map((p) => `${p.taskId}:${p.statusLabel}:${p.startLabel}`));
await client.close();
