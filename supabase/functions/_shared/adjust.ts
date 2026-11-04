// Gerenciar odds (Admin): ajuste em % por mercado e resultado, aplicado depois da margem (settings.odds_adjust)
import type { Markets } from "./providers.ts";

export type Adjust = Record<string, Record<string, { pct?: number; on?: boolean }>>;

// def = % padrão para o que não tem ajuste próprio no Gerenciar odds
const factor = (a: Adjust | null | undefined, mk: string, pick: string, def = 0) => {
  const e = a?.[mk]?.[pick];
  return e?.on && Number(e.pct) ? 1 + Number(e.pct) / 100 : 1 + def / 100;
};
const scale = (x: number | null | undefined, f: number) =>
  x && x > 1 && f !== 1 ? Math.max(1.01, Math.floor(x * f * 100 + 1e-9) / 100) : x ?? null;

export function adjustOdds<T extends { home?: number | null; draw?: number | null; away?: number | null }>(o: T, a: Adjust | null | undefined): T {
  if (!a) return o;
  const out = { ...o };
  for (const k of ["home", "draw", "away"] as const) if (o[k] != null) out[k] = scale(o[k], factor(a, "1x2", k)) as T[typeof k];
  return out;
}

export function adjustMarkets(mk: Markets | null | undefined, a: Adjust | null | undefined, def = 0): Markets | null {
  if (!mk || (!a && !def)) return mk ?? null;
  return Object.fromEntries(Object.entries(mk).map(([k, o]) =>
    [k, Object.fromEntries(Object.entries(o).map(([p, x]) => [p, scale(x, factor(a, k, p, def)) as number]))]));
}

// teto das odds ao vivo (settings.live_odd_max; 0 = sem teto)
const cap = (x: number | null | undefined, max: number) => (x && max > 1 && x > max ? max : x ?? null);
export function capOdds<T extends { home?: number | null; draw?: number | null; away?: number | null }>(o: T, max: number): T {
  if (!(max > 1)) return o;
  const out = { ...o };
  for (const k of ["home", "draw", "away"] as const) if (o[k] != null) out[k] = cap(o[k], max) as T[typeof k];
  return out;
}
export function capMarkets(mk: Markets | null | undefined, max: number): Markets | null {
  if (!mk || !(max > 1)) return mk ?? null;
  return Object.fromEntries(Object.entries(mk).map(([k, o]) => [k, Object.fromEntries(Object.entries(o).map(([p, x]) => [p, cap(x, max) as number]))]));
}
