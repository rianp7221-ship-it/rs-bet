import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Servidor (cron/webhook com header x-cron-secret) usa service_role; navegador precisa ser admin logado.
export async function adminClient(req: Request): Promise<SupabaseClient | Response> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") === secret) {
    return createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  }
  const sb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "Faça login" }, 401);
  const { data: ok } = await sb.rpc("has_perm", { p_perm: "sports.manage" });
  if (!ok) return json({ error: "Sem permissão" }, 403);
  return sb;
}
