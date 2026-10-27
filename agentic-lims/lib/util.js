/**
 * Small date / text helpers shared by the host half.
 * The prototype deliberately uses a frozen demo clock so the bundled mock data
 * (2026-10-27 onwards) keeps producing the same story.
 */

export const TZ = '+08:00';
export const DEMO_NOW = '2026-10-27T08:00:00+08:00';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round1(value) {
  return Math.round(value * 10) / 10;
}

export function parseInstant(value, fallback = new Date(DEMO_NOW)) {
  if (!value) return new Date(fallback);
  if (value instanceof Date) return new Date(value.getTime());
  const text = String(value).trim();
  if (!text) return new Date(fallback);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00${TZ}`);
  if (/\d{2}:\d{2}(:\d{2})?$/.test(text) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    return new Date(`${text.replace(' ', 'T')}${TZ}`);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed;
}

export function dateKey(value) {
  const date = value instanceof Date ? value : parseInstant(value);
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function addDays(value, days) {
  const date = value instanceof Date ? new Date(value.getTime()) : parseInstant(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function addMinutes(value, minutes) {
  return new Date(parseInstant(value).getTime() + minutes * 60 * 1000);
}

export function startOfDay(value) {
  return new Date(`${dateKey(value)}T00:00:00${TZ}`);
}

export function minToTime(minutes) {
  const m = clamp(Math.round(minutes), 0, 24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function timeToMin(value, fallback = 0) {
  const text = String(value ?? '').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function diffHours(later, earlier) {
  return (parseInstant(later).getTime() - parseInstant(earlier).getTime()) / 3600000;
}

export function dayLabel(value) {
  const date = parseInstant(value);
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return WEEKDAYS[shifted.getUTCDay()];
}

export function formatDate(value, withWeekday = false) {
  if (!value) return '—';
  const key = dateKey(value);
  const [, month, day] = key.split('-');
  return withWeekday ? `${month}/${day} ${dayLabel(value)}` : `${month}/${day}`;
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = parseInstant(value);
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(5, 10).replace('-', '/')} ${shifted.toISOString().slice(11, 16)}`;
}

export function formatHours(hours) {
  const value = round1(Number(hours) || 0);
  return `${value}h`;
}

export function splitList(value, separator = ';') {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? '')
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function titleCase(value) {
  return String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
}

export function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

export function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function priorityRank(priority) {
  return { Urgent: 0, High: 1, Normal: 2, Low: 3 }[priority] ?? 4;
}

export function stableId(prefix, date = new Date()) {
  const stamp = date.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${suffix}`;
}
