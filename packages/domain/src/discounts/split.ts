/** Splits `total` over `weights` in proportion; the last non-zero weight takes the rounding remainder, so the parts add up exactly. */
export function splitProportionally(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const lastIdx = weights.reduce((acc, w, i) => (w > 0 ? i : acc), -1);
  let given = 0;
  return weights.map((w, i) => {
    if (w <= 0) return 0;
    if (i === lastIdx) return total - given;
    const share = Math.floor((w * total) / sum);
    given += share;
    return share;
  });
}
