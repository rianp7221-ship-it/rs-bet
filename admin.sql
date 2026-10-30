-- =====================================================
--  admin.sql — libera o painel admin (admin.html) para um email
--  1) Crie a conta no site com esse email.
--  2) Rode no Supabase > SQL Editor.
-- =====================================================
update public.profiles set is_admin = true where email = 'rianp7221@gmail.com';

-- conferir:
select id, email, is_admin from public.profiles where email = 'rianp7221@gmail.com';
