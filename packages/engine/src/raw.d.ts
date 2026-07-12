/**
 * Vite `?raw` imports for the in-worker Python sources (M3.0): the .py files
 * are real Python (editable/lintable as Python) and arrive as strings at
 * bundle time. Resolved by Vite/Vitest; tsc sees this ambient declaration.
 */
declare module '*.py?raw' {
  const contents: string;
  export default contents;
}
