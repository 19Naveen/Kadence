/** Suggest a join key pair only when both datasets share a column name (exact, then
 *  case-insensitive), preferring id-like names. Returns null otherwise: pairing unrelated
 *  columns (e.g. RowNumber = Rooms) silently produces a wrong join, so the user picks. */
export function suggestJoinKeys(left: string[], right: string[]): { left_on: string; right_on: string } | null {
  const idLike = (c: string) => /(^|_|[a-z])(id|key|code)$/i.test(c);
  const exact = left.filter((c) => right.includes(c));
  const pick = exact.find(idLike) ?? exact[0];
  if (pick) return { left_on: pick, right_on: pick };
  const lower = new Map(right.map((c) => [c.toLowerCase(), c]));
  const ci = left.filter((c) => lower.has(c.toLowerCase()));
  const ciPick = ci.find(idLike) ?? ci[0];
  return ciPick ? { left_on: ciPick, right_on: lower.get(ciPick.toLowerCase())! } : null;
}
