// ShiftPay calculation core: pure functions only (no DOM, no storage) so it can be unit-tested.
// Money is always integer cents; time is always integer minutes; dates are "YYYY-MM-DD" strings.

export const MINUTES_PER_DAY = 1440;
const MS_PER_DAY = 86_400_000;

export const RATE_TYPES = ['weekday', 'saturday', 'sunday'];
export const RATE_LABELS = { weekday: 'Weekday', saturday: 'Saturday', sunday: 'Sunday' };
export const PERIOD_TYPES = ['weekly', 'fortnightly', 'monthly'];
const PERIOD_DAYS = { weekly: 7, fortnightly: 14 };

export const DEFAULT_SETTINGS = Object.freeze({
  currency: 'USD',
  rates: Object.freeze({ weekday: 0, saturday: 0, sunday: 0 }),
  periodType: 'weekly',
  periodStart: '2024-01-01', // a Monday
});

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- dates (UTC maths so daylight saving can never shift a day) ----------

export function isValidDate(iso) {
  if (!DATE_RE.test(iso ?? '')) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

export function fromDayNumber(n) {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export const addDays = (iso, days) => fromDayNumber(dayNumber(iso) + days);

export function toIsoLocal(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function rateTypeFor(iso) {
  const weekday = new Date(dayNumber(iso) * MS_PER_DAY).getUTCDay();
  if (weekday === 6) return 'saturday';
  if (weekday === 0) return 'sunday';
  return 'weekday';
}

// ---------- times and shifts ----------

export function parseTime(value) {
  const match = TIME_RE.exec(value ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// Minutes between start and end; an end earlier than the start means the shift ends next day.
export function shiftDuration(start, end) {
  const s = parseTime(start);
  const e = parseTime(end);
  if (s === null || e === null || s === e) return null;
  return e > s ? e - s : e + MINUTES_PER_DAY - s;
}

export function calculateShift(shift, settings) {
  const totalMinutes = shiftDuration(shift.start, shift.end) ?? 0;
  const paidMinutes = Math.max(0, totalMinutes - (Number(shift.breakMinutes) || 0));
  const rateType = RATE_TYPES.includes(shift.rateType) ? shift.rateType : rateTypeFor(shift.date);
  const rateCents = settings.rates[rateType] ?? 0;
  const payCents = Math.round((paidMinutes * rateCents) / 60);
  return { totalMinutes, paidMinutes, rateType, rateCents, payCents };
}

export function summarize(shifts, settings) {
  const totals = { count: 0, paidMinutes: 0, payCents: 0, byType: {} };
  for (const type of RATE_TYPES) totals.byType[type] = { paidMinutes: 0, payCents: 0 };
  for (const shift of shifts) {
    const r = calculateShift(shift, settings);
    totals.count += 1;
    totals.paidMinutes += r.paidMinutes;
    totals.payCents += r.payCents;
    totals.byType[r.rateType].paidMinutes += r.paidMinutes;
    totals.byType[r.rateType].payCents += r.payCents;
  }
  return totals;
}

export const byStart = (a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`);

export function shiftsInRange(shifts, start, end) {
  return shifts.filter((s) => s.date >= start && s.date <= end).sort(byStart);
}

function shiftInterval(shift) {
  const start = dayNumber(shift.date) * MINUTES_PER_DAY + parseTime(shift.start);
  return [start, start + shiftDuration(shift.start, shift.end)];
}

export function findOverlap(shift, shifts, ignoreId = null) {
  const [aStart, aEnd] = shiftInterval(shift);
  return shifts.find((other) => {
    if (other.id === ignoreId) return false;
    const [bStart, bEnd] = shiftInterval(other);
    return aStart < bEnd && bStart < aEnd;
  }) ?? null;
}

// ---------- pay periods ----------

export function getPeriod(iso, settings) {
  if (settings.periodType === 'monthly') {
    const [y, m] = iso.split('-').map(Number);
    const start = Date.UTC(y, m - 1, 1) / MS_PER_DAY;
    const end = Date.UTC(y, m, 1) / MS_PER_DAY - 1; // Date.UTC rolls month 12 into next year
    return { start: fromDayNumber(start), end: fromDayNumber(end) };
  }
  const length = PERIOD_DAYS[settings.periodType] ?? 7;
  const anchor = dayNumber(settings.periodStart);
  const startN = anchor + Math.floor((dayNumber(iso) - anchor) / length) * length;
  return { start: fromDayNumber(startN), end: fromDayNumber(startN + length - 1) };
}

export function stepPeriod(iso, settings, direction) {
  const { start, end } = getPeriod(iso, settings);
  return direction < 0 ? addDays(start, -1) : addDays(end, 1);
}

// ---------- validation ----------

export function parseMoney(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

export function validateShift(raw) {
  const errors = {};
  const start = String(raw.start ?? '').slice(0, 5);
  const end = String(raw.end ?? '').slice(0, 5);
  const total = shiftDuration(start, end);

  if (!isValidDate(raw.date)) errors.date = 'Choose a valid date.';
  if (parseTime(start) === null) errors.start = 'Enter a start time.';
  if (parseTime(end) === null) errors.end = 'Enter an end time.';
  else if (parseTime(start) !== null && total === null) errors.end = 'End time must differ from start time.';

  const breakText = String(raw.breakMinutes ?? '').trim();
  const breakMinutes = breakText === '' ? 0 : Number(breakText);
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0) {
    errors.breakMinutes = 'Break must be a whole number of minutes, 0 or more.';
  } else if (total !== null && breakMinutes >= total) {
    errors.breakMinutes = 'Break must be shorter than the shift.';
  }

  const rateType = raw.rateType || 'auto';
  if (rateType !== 'auto' && !RATE_TYPES.includes(rateType)) errors.rateType = 'Choose a rate type.';

  const note = String(raw.note ?? '').trim();
  if (note.length > 100) errors.note = 'Keep notes under 100 characters.';

  return { errors, value: { date: raw.date, start, end, breakMinutes, rateType, note } };
}

export function validateSettings(raw) {
  const errors = {};
  const rates = {};
  const currency = String(raw.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'Use a 3-letter currency code, e.g. USD, GBP, AUD.';

  for (const type of RATE_TYPES) {
    const cents = parseMoney(raw[`${type}Rate`]);
    if (cents === null) errors[`${type}Rate`] = 'Enter an hourly rate like 25 or 25.50.';
    else rates[type] = cents;
  }

  const periodType = raw.periodType;
  if (!PERIOD_TYPES.includes(periodType)) errors.periodType = 'Choose a pay period.';
  if (periodType !== 'monthly' && !isValidDate(raw.periodStart)) {
    errors.periodStart = 'Choose the first day of any pay period.';
  }

  const periodStart = isValidDate(raw.periodStart) ? raw.periodStart : DEFAULT_SETTINGS.periodStart;
  return { errors, value: { currency, rates, periodType, periodStart } };
}

// ---------- formatting ----------

export function formatMoney(cents, currency, { code = false } = {}) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, currencyDisplay: code ? 'code' : 'symbol',
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export function formatHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const decimalHours = (minutes) => (minutes / 60).toFixed(2);
