/** Pick the most likely join key pair between two column lists. */
export function suggestJoinKeys(left: string[], right: string[]): { left_on: string; right_on: string } | null {
  if (!left.length || !right.length) return null;
  const idLike = (c: string) => /(^|_)(id|key|code)$/i.test(c);
  const exact = left.filter((c) => right.includes(c));
  const pick = exact.find(idLike) ?? exact[0];
  if (pick) return { left_on: pick, right_on: pick };
  const lower = new Map(right.map((c) => [c.toLowerCase(), c]));
  const ci = left.filter((c) => lower.has(c.toLowerCase()));
  const ciPick = ci.find(idLike) ?? ci[0];
  if (ciPick) return { left_on: ciPick, right_on: lower.get(ciPick.toLowerCase())! };
  return { left_on: left.find(idLike) ?? left[0], right_on: right.find(idLike) ?? right[0] };
}
