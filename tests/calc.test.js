import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS, parseTime, shiftDuration, calculateShift, rateTypeFor, summarize,
  getPeriod, stepPeriod, validateShift, validateSettings, parseMoney, findOverlap,
} from '../www/js/calc.js';
import { buildCsv } from '../www/js/export.js';

const settings = {
  ...DEFAULT_SETTINGS,
  currency: 'USD',
  rates: { weekday: 2500, saturday: 3000, sunday: 3500 },
};
// 2026-10-21 = Wednesday, 2026-10-24 = Saturday, 2026-10-25 = Sunday

describe('time maths', () => {
  it('parses HH:MM', () => {
    expect(parseTime('09:30')).toBe(570);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
  it('handles overnight shifts', () => expect(shiftDuration('22:00', '06:00')).toBe(480));
  it('rejects zero-length shifts', () => expect(shiftDuration('09:00', '09:00')).toBeNull());
  it('detects weekend days', () => {
    expect(rateTypeFor('2026-10-21')).toBe('weekday');
    expect(rateTypeFor('2026-10-24')).toBe('saturday');
    expect(rateTypeFor('2026-10-25')).toBe('sunday');
  });
});

describe('pay', () => {
  it('deducts the unpaid break and uses the weekday rate', () => {
    const r = calculateShift({ date: '2026-10-21', start: '09:00', end: '17:30', breakMinutes: 30, rateType: 'auto' }, settings);
    expect(r).toMatchObject({ paidMinutes: 480, rateType: 'weekday', payCents: 20000 });
  });
  it('uses the Saturday rate for an overnight shift starting Saturday', () => {
    const r = calculateShift({ date: '2026-10-24', start: '22:00', end: '02:00', breakMinutes: 0, rateType: 'auto' }, settings);
    expect(r.payCents).toBe(12000);
  });
  it('respects a manual rate override', () => {
    const r = calculateShift({ date: '2026-10-21', start: '09:00', end: '10:00', breakMinutes: 0, rateType: 'sunday' }, settings);
    expect(r.payCents).toBe(3500);
  });
  it('rounds to the nearest cent', () => {
    const r = calculateShift({ date: '2026-10-21', start: '09:00', end: '09:07', breakMinutes: 0, rateType: 'auto' }, settings);
    expect(r.payCents).toBe(292); // 7/60 * 2500 = 291.67
  });
  it('summarises totals by rate type', () => {
    const t = summarize([
      { date: '2026-10-21', start: '09:00', end: '17:00', breakMinutes: 0, rateType: 'auto' },
      { date: '2026-10-25', start: '10:00', end: '12:00', breakMinutes: 0, rateType: 'auto' },
    ], settings);
    expect(t).toMatchObject({ count: 2, paidMinutes: 600, payCents: 27000 });
    expect(t.byType.sunday.payCents).toBe(7000);
  });
});

describe('pay periods', () => {
  it('finds a Monday-Sunday week', () => {
    expect(getPeriod('2026-10-25', settings)).toEqual({ start: '2026-10-19', end: '2026-10-25' });
  });
  it('works for dates before the anchor', () => {
    expect(getPeriod('2023-12-31', settings)).toEqual({ start: '2023-12-25', end: '2023-12-31' });
  });
  it('handles fortnights', () => {
    const f = { ...settings, periodType: 'fortnightly', periodStart: '2026-10-12' };
    expect(getPeriod('2026-10-25', f)).toEqual({ start: '2026-10-12', end: '2026-10-25' });
    expect(getPeriod('2026-10-26', f)).toEqual({ start: '2026-10-26', end: '2026-11-08' });
  });
  it('handles calendar months and leap years', () => {
    const m = { ...settings, periodType: 'monthly' };
    expect(getPeriod('2028-02-10', m)).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(stepPeriod('2026-12-15', m, 1)).toBe('2027-01-01');
  });
});

describe('validation', () => {
  const ok = { date: '2026-10-21', start: '09:00', end: '17:00', breakMinutes: '30', rateType: 'auto', note: '' };
  it('accepts a valid shift', () => expect(validateShift(ok).errors).toEqual({}));
  it('rejects impossible dates', () => expect(validateShift({ ...ok, date: '2026-02-30' }).errors.date).toBeDefined());
  it('rejects a break as long as the shift', () => {
    expect(validateShift({ ...ok, breakMinutes: '480' }).errors.breakMinutes).toMatch(/shorter/);
  });
  it('rejects negative or fractional breaks', () => {
    expect(validateShift({ ...ok, breakMinutes: '-5' }).errors.breakMinutes).toBeDefined();
    expect(validateShift({ ...ok, breakMinutes: '2.5' }).errors.breakMinutes).toBeDefined();
  });
  it('parses money safely', () => {
    expect(parseMoney('25.5')).toBe(2550);
    expect(parseMoney('25,50')).toBe(2550);
    expect(parseMoney('0.29')).toBe(29);
    expect(parseMoney('-1')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
  it('validates settings', () => {
    const { errors } = validateSettings({ currency: 'us', weekdayRate: '', saturdayRate: '30', sundayRate: '35', periodType: 'weekly', periodStart: '2026-10-19' });
    expect(Object.keys(errors).sort()).toEqual(['currency', 'weekdayRate']);
  });
  it('finds overlapping shifts, including overnight ones', () => {
    const existing = [{ id: 'a', date: '2026-10-24', start: '22:00', end: '06:00' }];
    expect(findOverlap({ date: '2026-10-25', start: '05:00', end: '09:00' }, existing)?.id).toBe('a');
    expect(findOverlap({ date: '2026-10-25', start: '06:00', end: '09:00' }, existing)).toBeNull();
  });
});

describe('CSV export', () => {
  const csv = buildCsv([
    { date: '2026-10-21', start: '09:00', end: '17:00', breakMinutes: 30, rateType: 'auto', note: 'Hello, "boss"' },
    { date: '2026-10-22', start: '09:00', end: '10:00', breakMinutes: 0, rateType: 'auto', note: '=HYPERLINK("x")' },
  ], settings);
  it('starts with a UTF-8 BOM and a header', () => {
    expect(csv.startsWith('\uFEFFDate,')).toBe(true);
  });
  it('escapes commas and quotes', () => expect(csv).toContain('"Hello, ""boss"""'));
  it('neutralises spreadsheet formulas', () => expect(csv).toContain(`"'=HYPERLINK(""x"")"`));
  it('includes a matching total', () => expect(csv).toContain('Total,,,,,8.50,,212.50'));
});
