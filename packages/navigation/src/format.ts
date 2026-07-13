/**
 * Duration formatting and time-limit parsing, ported verbatim from the
 * legacy server frontend (blockpy-server):
 *
 *   - formatAmount: frontend/utilities/dates.ts:104-151 — the countdown span
 *     uses the COARSE tiers (`formatAmount(x, " elapsed", true)`,
 *     assignment_interface.ts:248-252).
 *   - parseTimeLimit: frontend/components/assignment_interface.ts:20-45 —
 *     `"Nmin"` base limits plus per-student `"Nmin"` (absolute) or `"Nx"`
 *     (multiplier) overrides from submission.timeLimit().
 */

export function formatAmount(delta: number, sign: string, coarse = false, round = false): string {
  const operation = round ? Math.round : Math.floor;
  const years = operation(delta / (365 * 3600 * 24));
  const days = operation((delta % (365 * 3600 * 24)) / (3600 * 24));
  const hours = operation((delta % (3600 * 24)) / 3600);
  const minutes = operation((delta % 3600) / 60);
  const seconds = operation(delta % 60);

  const yearsDisplay = `${years} year${years !== 1 ? 's' : ''}`;
  const daysDisplay = `${days} day${days !== 1 ? 's' : ''}`;
  const hoursDisplay = `${hours} hour${hours !== 1 ? 's' : ''}`;
  const minutesDisplay = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  const secondsDisplay = `${seconds} second${seconds !== 1 ? 's' : ''}`;

  if (coarse) {
    if (delta < -30) {
      return 'Time past!';
    } else if (delta < 1) {
      return 'At this time';
    } else if (delta < 60) {
      return '<1 minute' + sign;
    } else if (delta < 60 * 60) {
      return minutesDisplay + sign;
    } else if (delta < 24 * 60 * 60) {
      return hoursDisplay + ', ' + minutesDisplay + sign;
    } else if (delta < 365 * 24 * 60 * 60) {
      return daysDisplay + ', ' + hoursDisplay + sign;
    } else {
      return yearsDisplay + ', ' + daysDisplay + sign;
    }
  } else {
    if (delta < 1) {
      return 'At this time';
    } else if (delta < 60) {
      return secondsDisplay + sign;
    } else if (delta < 60 * 10) {
      return minutesDisplay + ', ' + secondsDisplay + sign;
    } else if (delta < 60 * 60) {
      return minutesDisplay + sign;
    } else if (delta < 24 * 60 * 60) {
      return hoursDisplay + ', ' + minutesDisplay + sign;
    } else if (delta < 365 * 24 * 60 * 60) {
      return daysDisplay + ', ' + hoursDisplay + sign;
    } else {
      return yearsDisplay + ', ' + daysDisplay + sign;
    }
  }
}

/** Seconds allowed, or 0 (with a console.error) on unparseable input. */
export function parseTimeLimit(timeLimit: string, studentLimit: string | null): number {
  let modifier = 1;
  if (studentLimit) {
    if (studentLimit.includes('min')) {
      return parseInt(studentLimit.replace('min', '').trim(), 10) * 60;
    } else if (studentLimit.includes('x')) {
      modifier = parseFloat(studentLimit.replace('x', '').trim());
    } else {
      console.error('Unknown time limit format', studentLimit);
    }
  }
  if (timeLimit.includes('min')) {
    const minutes = parseInt(timeLimit.replace('min', '').trim(), 10);
    return minutes * 60 * modifier;
  } else {
    const minutes = parseInt(timeLimit.trim(), 10);
    if (isNaN(minutes)) {
      console.error('Unknown time limit format', timeLimit);
      return 0;
    }
    return minutes * 60 * modifier;
  }
}

/**
 * Time-spent clock tiers — the `refreshClock` body from the legacy
 * editor.html:403-425, as a pure function of the accumulated duration
 * (seconds). Precisions per A7 §5: cap at `hours >= 99`, singular
 * `~1 minute spent`, zero-padded minutes in the `~H:MM hours spent` tier.
 */
export function formatClockDuration(duration: number): string {
  const hours = Math.floor(duration / 60 / 60);
  const oMinutes = Math.floor((duration / 60) % 60);
  const minutes = oMinutes < 10 ? '0' + String(oMinutes) : String(oMinutes);
  if (hours >= 99) {
    return '99+ hours spent';
  } else if (hours < 1) {
    if (oMinutes < 1) {
      return '(Just started)';
    } else if (oMinutes === 1) {
      return `~${oMinutes} minute spent`;
    } else {
      return `~${oMinutes} minutes spent`;
    }
  } else {
    return `~${hours}:${minutes} hours spent`;
  }
}
