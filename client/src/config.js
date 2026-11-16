// Адрес проекта Supabase и публичный ключ. Этот ключ не секретный: он попадает в браузер
// и сам по себе не даёт доступа к таблицам (они закрыты RLS, вся логика — в Edge Function).
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://pkiiuuhnhsujypxixdzj.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_-lrzLSCvguRb0hZiyVMFEQ_NpJ9TpCA';
