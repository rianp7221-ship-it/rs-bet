// =====================================================
//  supabase.js — conexão com o banco
//  Troque pelos dados do SEU projeto (Supabase > Project Settings > API).
//  A "anon key" é pública, pode ficar aqui. NUNCA coloque a service_role.
// =====================================================
const SUPABASE_URL = "https://dmfkexixfkmxyribrjvk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_M0iqKBg0VwWfcoX6qwKnrg_RuDAaeHB";

// biblioteca carregada via <script> do CDN nas páginas HTML
window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
