/**
 * Numeric value of a Python number literal's source text. Shared by the
 * CST → AST pass (`Num.n`) and the `ast_Num` block (to detect whether the
 * user has edited the field away from the literal it was created from).
 * `1j` yields its imaginary magnitude; the `j` lives only in the source.
 */
export function numberLiteralValue(source: string): number {
  let numeric = source.replace(/_/g, '');
  if (/[jJ]$/.test(numeric)) {
    numeric = numeric.slice(0, -1);
  }
  if (/^0[oO]/.test(numeric)) {
    return parseInt(numeric.slice(2), 8);
  }
  if (/^0[bB]/.test(numeric)) {
    return parseInt(numeric.slice(2), 2);
  }
  return Number(numeric);
}
