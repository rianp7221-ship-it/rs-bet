// =====================================================
//  supabase.js — conexão com o banco
//  Troque pelos dados do SEU projeto (Supabase > Project Settings > API).
//  A "anon key" é pública, pode ficar aqui. NUNCA coloque a service_role.
// =====================================================
const SUPABASE_URL = "https://pscpcxleyysspvwkevpe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wZYqk42N5iDD-Mv7emPp0A_UQm8cLNV";

// biblioteca carregada via <script> do CDN nas páginas HTML
window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
