// =====================================================
//  supabase.js — conexão com o banco
//  Troque pelos dados do SEU projeto (Supabase > Project Settings > API).
//  A "anon key" é pública, pode ficar aqui. NUNCA coloque a service_role.
// =====================================================
const SUPABASE_URL = "https://pscpcxleyysspvwkevpe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wZYqk42N5iDD-Mv7emPp0A_UQm8cLNV";

// biblioteca carregada via <script> do CDN nas páginas HTML
window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// tema do site (Admin → Configurações → Tema do site); o <head> já aplica o último tema salvo neste aparelho
window.applyTheme = (t) => {
  const on = t === "verde", css = document.getElementById("t365");
  if (css) css.media = on ? "all" : "not all";
  document.documentElement.dataset.theme = on ? "verde" : "classico";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && css) meta.content = on ? "#126e51" : "#ff4d00";
  try { localStorage.rs_theme = on ? "verde" : "classico"; } catch {}
};
window.sb.rpc("site_theme").then(({ data }) => data && window.applyTheme(data));
