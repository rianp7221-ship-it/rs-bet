// =====================================================
//  supabase.js — conexão com o banco
//  Troque pelos dados do SEU projeto (Supabase > Project Settings > API).
//  A "anon key" é pública, pode ficar aqui. NUNCA coloque a service_role.
// =====================================================
const SUPABASE_URL = "https://eyikgikngskbbutuxuaj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aWtnaWtuZ3NrYmJ1dHV4dWFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNDc1NjEsImV4cCI6MjEwODcyMzU2MX0.BszkQeKnrxb9PSA67K0uNzEagC2KLyDEDNYORPif5Fc";

// biblioteca carregada via <script> do CDN nas páginas HTML
window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
