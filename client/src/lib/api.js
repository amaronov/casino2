import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

const ENDPOINT = SUPABASE_URL + '/functions/v1/api';
const TOKEN_KEY = 'nova.token';
let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch { /* хранилище недоступно */ }

export const getToken = () => token;
export function setToken(t) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* хранилище недоступно */ }
}

// Все запросы идут в одну Edge Function: api('lobby'), api('act', { room, a: 'spin', bet }).
export async function api(op, payload = {}) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        ...(token ? { 'x-casino-token': token } : {}),
      },
      body: JSON.stringify({ op, ...payload }),
    });
  } catch {
    const err = new Error('Нет связи с сервером');
    err.offline = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Ошибка запроса');
    err.status = res.status;
    throw err;
  }
  return data;
}
