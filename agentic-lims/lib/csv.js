import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Minimal RFC4180-ish CSV parser: quoted commas, doubled quotes, CRLF. */
export function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // Ignore; the following \n terminates the row.
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows
    .slice(1)
    .filter((cells) => cells.some((cell) => String(cell).trim() !== ''))
    .map((cells) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = (cells[index] ?? '').trim();
      });
      return record;
    });
}

const FILES = {
  persons: 'persons.csv',
  competencies: 'competencies.csv',
  equipment: 'equipment_resources.csv',
  standards: 'standards.csv',
  specs: 'specs.csv',
  specActivities: 'spec_activities.csv',
  plans: 'plans.csv',
  activities: 'person_activities.csv',
  assignments: 'resource_assignments.csv',
  allocations: 'daily_schedule_allocations.csv',
  history: 'historical_schedules.csv',
  constraints: 'constraints.csv',
};

/** Load every bundled CSV once; the result is plain JSON. */
export async function loadRawDataset(dataDir = join(HERE, '..', 'data')) {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, file]) => {
      const text = await readFile(join(dataDir, file), 'utf8');
      return [key, parseCsv(text)];
    }),
  );
  return Object.fromEntries(entries);
}

export { join, dirname };
