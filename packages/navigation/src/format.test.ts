import { describe, expect, it, vi } from 'vitest';
import { formatAmount, formatClockDuration, parseTimeLimit } from './format';

describe('formatAmount coarse tiers (dates.ts:118-133 — the countdown format)', () => {
  it.each([
    [-60, 'Time past!'],
    [0, 'At this time'],
    [45, '<1 minute left'],
    [61, '1 minute left'],
    [150, '2 minutes left'],
    [3600, '1 hour, 0 minutes left'],
    [3660 + 3600, '2 hours, 1 minute left'],
    [26 * 3600, '1 day, 2 hours left'],
    [400 * 24 * 3600, '1 year, 35 days left'],
  ])('formats %d seconds as %s', (delta, expected) => {
    expect(formatAmount(delta, ' left', true)).toBe(expected);
  });

  it('floors partial units by default (round=false)', () => {
    expect(formatAmount(119, ' elapsed', true)).toBe('1 minute elapsed');
  });
});

describe('parseTimeLimit (assignment_interface.ts:20-45)', () => {
  it('parses "Nmin" and bare-minutes base limits to seconds', () => {
    expect(parseTimeLimit('45min', null)).toBe(45 * 60);
    expect(parseTimeLimit('45', null)).toBe(45 * 60);
  });

  it('per-student "Nmin" override is absolute and wins outright', () => {
    expect(parseTimeLimit('45min', '90min')).toBe(90 * 60);
  });

  it('per-student "Nx" override multiplies the base limit', () => {
    expect(parseTimeLimit('40min', '1.5x')).toBe(60 * 60);
  });

  it('unknown formats log an error; unparseable base yields 0', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(parseTimeLimit('whenever', null)).toBe(0);
    // Unknown student format falls through to the base limit (modifier 1).
    expect(parseTimeLimit('30min', 'later')).toBe(30 * 60);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe('formatClockDuration tiers (editor.html:403-425, A7 §5)', () => {
  it.each([
    [0, '(Just started)'],
    [59, '(Just started)'],
    [60, '~1 minute spent'], // singular
    [125, '~2 minutes spent'],
    [59 * 60, '~59 minutes spent'],
    [3600, '~1:00 hours spent'], // zero-padded minutes
    [3660, '~1:01 hours spent'],
    [98 * 3600 + 30 * 60, '~98:30 hours spent'],
    [99 * 3600, '99+ hours spent'], // cap triggers at hours >= 99
  ])('formats %d seconds as %s', (duration, expected) => {
    expect(formatClockDuration(duration)).toBe(expected);
  });
});
