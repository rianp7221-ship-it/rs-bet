// Gerenciar odds (Admin): ajuste em % por mercado e resultado, aplicado depois da margem (settings.odds_adjust)
import type { Markets } from "./providers.ts";

export type Adjust = Record<string, Record<string, { pct?: number; on?: boolean }>>;

const factor = (a: Adjust | null | undefined, mk: string, pick: string) => {
  const e = a?.[mk]?.[pick];
  return e?.on && Number(e.pct) ? 1 + Number(e.pct) / 100 : 1;
};
const scale = (x: number | null | undefined, f: number) =>
  x && x > 1 && f !== 1 ? Math.max(1.01, Math.floor(x * f * 100 + 1e-9) / 100) : x ?? null;

export function adjustOdds<T extends { home?: number | null; draw?: number | null; away?: number | null }>(o: T, a: Adjust | null | undefined): T {
  if (!a) return o;
  const out = { ...o };
  for (const k of ["home", "draw", "away"] as const) if (o[k] != null) out[k] = scale(o[k], factor(a, "1x2", k)) as T[typeof k];
  return out;
}

export function adjustMarkets(mk: Markets | null | undefined, a: Adjust | null | undefined): Markets | null {
  if (!mk || !a) return mk ?? null;
  return Object.fromEntries(Object.entries(mk).map(([k, o]) =>
    [k, Object.fromEntries(Object.entries(o).map(([p, x]) => [p, scale(x, factor(a, k, p)) as number]))]));
}
