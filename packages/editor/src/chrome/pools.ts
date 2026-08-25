/**
 * Question pools (legacy `src/pools.js`, verbatim semantics): an
 * assignment's instructions and on_run may hold several alternatives
 * separated by header/footer markers; the seed picks one per student.
 *
 *   instructions:  <!----# name #---->  ... blocks ...  <!----# name #---->
 *   on_run:        #### name ####      ... blocks ...  #### name ####
 *
 * The first and last segments (before the first marker / after the last)
 * are shared preamble/footer; `calculatePoolIndex` picks one of the inner
 * segments from the seed.
 */

export const POOL_SEPARATORS = {
  TESTS: /#{4,} .+ #{4,}/,
  INSTRUCTIONS: /<!-{4,}# .+ #-{4,}>/,
};

/** Legacy `currentSeed` is `poolSeed || submission.id`; coerce like JS `%`. */
function seedNumber(seed: string | number | null | undefined): number {
  const value = Number(seed);
  return Number.isFinite(value) ? value : 0;
}

export function calculatePoolIndex(
  pools: string[],
  seed: string | number | null | undefined,
): number {
  return 1 + (seedNumber(seed) % (pools.length - 2));
}

export function extractFromPool(
  pool: string,
  splitter: RegExp,
  seed: string | number | null | undefined,
): string {
  const pools = pool.split(splitter);
  if (pools.length <= 2) {
    return (
      '#>>> Invalid Pool: Not Enough Parts!\n# Remember to include header and footer!\n# Original data is below\n' +
      pool
    );
  }
  const chosenPool = pools[calculatePoolIndex(pools, seed)] ?? '';
  return [pools[0], chosenPool, pools[pools.length - 1]].join('\n');
}

export function countPools(pool: string, splitter: RegExp): number {
  return pool.split(splitter).length - 2;
}

/** Legacy `formatPoolInstructions` (pools.js:27-39). */
export function formatPoolInstructions(
  text: string,
  seed: string | number | null | undefined,
  isInstructor: boolean,
): string {
  let content = extractFromPool(text, POOL_SEPARATORS.INSTRUCTIONS, seed);
  if (isInstructor) {
    content +=
      '\n\n_This question was drawn from a randomized question pool. Adjust the seed to view a different question. Uncheck "View as Instructor" to hide this message; students will not see it either way._\n';
  }
  return content;
}
