import { describe, expect, it } from 'vitest';
import { countPools, extractFromPool, formatPoolInstructions, POOL_SEPARATORS } from './pools';

const INSTRUCTIONS = [
  'Preamble',
  '<!----# a #---->',
  'Question A',
  '<!----# b #---->',
  'Question B',
  '<!----# c #---->',
  'Question C',
  '<!----# end #---->',
  'Footer',
].join('\n');

const TESTS = [
  'from pedal import *',
  '#### a ####',
  'assert_equal(x, 1)',
  '#### b ####',
  'assert_equal(x, 2)',
  '#### end ####',
  'done()',
].join('\n');

describe('question pools (legacy pools.js)', () => {
  it('counts the inner alternatives', () => {
    expect(countPools(INSTRUCTIONS, POOL_SEPARATORS.INSTRUCTIONS)).toBe(3);
    expect(countPools(TESTS, POOL_SEPARATORS.TESTS)).toBe(2);
  });

  it('draws the alternative by seed, keeping preamble + footer', () => {
    // index = 1 + seed % 3 → seeds 0,1,2 pick A,B,C; seed 3 wraps to A.
    expect(extractFromPool(INSTRUCTIONS, POOL_SEPARATORS.INSTRUCTIONS, 0)).toBe(
      'Preamble\n\n\nQuestion A\n\n\nFooter',
    );
    expect(extractFromPool(INSTRUCTIONS, POOL_SEPARATORS.INSTRUCTIONS, '1')).toContain(
      'Question B',
    );
    expect(extractFromPool(INSTRUCTIONS, POOL_SEPARATORS.INSTRUCTIONS, 5)).toContain('Question C');
    expect(extractFromPool(INSTRUCTIONS, POOL_SEPARATORS.INSTRUCTIONS, 3)).toContain('Question A');
    expect(extractFromPool(TESTS, POOL_SEPARATORS.TESTS, 7)).toBe(
      'from pedal import *\n\n\nassert_equal(x, 2)\n\n\ndone()',
    );
  });

  it('flags a pool without header + footer instead of guessing', () => {
    const bad = extractFromPool('no markers here', POOL_SEPARATORS.TESTS, 1);
    expect(bad.startsWith('#>>> Invalid Pool')).toBe(true);
    expect(bad).toContain('no markers here');
  });

  it('appends the instructor-only pool note', () => {
    expect(formatPoolInstructions(INSTRUCTIONS, 0, false)).not.toContain(
      'randomized question pool',
    );
    expect(formatPoolInstructions(INSTRUCTIONS, 0, true)).toContain('randomized question pool');
  });
});
