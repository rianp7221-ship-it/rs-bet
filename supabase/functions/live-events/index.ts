// live-events — entrada de eventos ao vivo de qualquer API (webhook/push ou adaptador próprio).
// Auth: header x-cron-secret = CRON_SECRET (servidor) ou admin logado.
// Body: { events: [{ external_id, type, seconds?, reason?, odds?: {home,draw,away}, score?: {home,away} }] }
//   type "danger"  — ataque perigoso/pênalti/VAR: suspende apostas e cashout por `seconds` (padrão 20)
//   type "suspend" — suspende por `seconds` (padrão 60) | type "resume" — libera na hora
//   type "goal" / "score" — atualiza placar (gol no futebol/hóquei suspende 90s automaticamente)
//   type "odds"    — atualiza odds (variação > 15% suspende 30s automaticamente)
import { adminClient, cors, json } from "../_shared/auth.ts";

type LiveEvent = {
  external_id: string; type: string; seconds?: number; reason?: string;
  odds?: { home?: number; draw?: number | null; away?: number }; score?: { home: number; away: number };
};
const DEFAULT_SECONDS: Record<string, number> = { danger: 20, suspend: 60 };
const REASON: Record<string, string> = { danger: "Lance perigoso", suspend: "Suspenso" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = await adminClient(req);
  if (sb instanceof Response) return sb;
  const body = await req.json().catch(() => null);
  const events: LiveEvent[] = Array.isArray(body?.events) ? body.events : body?.external_id ? [body] : [];
  if (!events.length) return json({ error: "Envie { events: [...] }" }, 400);

  const errors: string[] = [];
  let applied = 0;
  for (const ev of events) {
    const patch: Record<string, unknown> = { synced_at: new Date().toISOString() };
    if (ev.type === "danger" || ev.type === "suspend") {
      const secs = Math.min(Math.max(Number(ev.seconds ?? DEFAULT_SECONDS[ev.type]), 1), 600);
      patch.suspended_until = new Date(Date.now() + secs * 1000).toISOString();
      patch.suspend_reason = ev.reason || REASON[ev.type];
    } else if (ev.type === "resume") {
      patch.suspended_until = null;
    } else if ((ev.type === "goal" || ev.type === "score") && ev.score) {
      patch.score_home = ev.score.home; patch.score_away = ev.score.away; patch.status = "live";
    } else if (ev.type === "odds" && ev.odds) {
      if (ev.odds.home) patch.odd_home = ev.odds.home;
      if (ev.odds.draw !== undefined) patch.odd_draw = ev.odds.draw;
      if (ev.odds.away) patch.odd_away = ev.odds.away;
      patch.odds_at = new Date().toISOString();
    } else { errors.push(`${ev.external_id}: tipo inválido ${ev.type}`); continue; }
    const { data, error } = await sb.from("matches").update(patch)
      .eq("external_id", ev.external_id).in("status", ["open", "live"]).select("id");
    if (error) errors.push(`${ev.external_id}: ${error.message}`);
    else if (!data?.length) errors.push(`${ev.external_id}: jogo não encontrado`);
    else applied++;
  }
  return json({ aplicados: applied, errors });
});
