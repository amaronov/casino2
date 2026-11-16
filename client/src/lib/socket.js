import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { api } from './api.js';

// Связь с игровой комнатой. Состояние отдаёт Edge Function; Supabase Realtime присылает
// только сигнал «в комнате что-то изменилось», после которого клиент запрашивает свежее
// состояние. Если Realtime недоступен, комната просто опрашивается чаще.
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const handlers = new Map(); // тип события -> Set обработчиков
let room = null;
let channel = null;
let live = false; // подписка Realtime активна
let version = -1;
let dueTimer = null;
let beatTimer = null;
let inflight = false;
let again = false;
let online = false;
// Разница между часами сервера и клиента — для точных таймеров.
export let clockOffset = 0;

function emit(type, msg) {
  handlers.get(type)?.forEach((fn) => fn(msg));
}
function setOnline(value) {
  if (online !== value) emit('status', { online: (online = value) });
}

function apply(roomId, res) {
  setOnline(true);
  emit('balance', { balance: res.balance });
  if (roomId !== room || res.state.v < version) return;
  version = res.state.v;
  clockOffset = res.state.now - Date.now();
  emit('state', { room: roomId, state: res.state });
  if (res.reply) emit(res.reply.t, res.reply);
  // У комнаты есть отложенное действие (конец хода, раунда) — заглянем сразу после срока.
  clearTimeout(dueTimer);
  if (res.state.nextAt) {
    const wait = res.state.nextAt - (Date.now() + clockOffset) + 150;
    dueTimer = setTimeout(refresh, Math.max(150, wait));
  }
}

function fail(e) {
  if (e.status === 401) emit('unauthorized', {});
  else if (e.offline) setOnline(false);
  else emit('error', { message: e.message });
}

async function refresh() {
  if (!room) return;
  if (inflight) { again = true; return; }
  inflight = true;
  const id = room;
  try {
    apply(id, await api('room', { room: id }));
  } catch (e) {
    if (!e.status || e.status === 401) fail(e);
  } finally {
    inflight = false;
    if (again) { again = false; refresh(); }
  }
}

function heartbeat() {
  clearTimeout(beatTimer);
  if (!room) return;
  // Пульс нужен и для присутствия за столом, и как запасной канал обновлений.
  beatTimer = setTimeout(() => { refresh(); heartbeat(); }, live ? 10_000 : 3_000);
}

function drop() {
  clearTimeout(dueTimer);
  clearTimeout(beatTimer);
  if (channel) supabase.removeChannel(channel);
  channel = null;
  live = false;
  room = null;
  version = -1;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});

export const socket = {
  connect() { setOnline(true); },
  disconnect() { drop(); online = false; },
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type).delete(fn);
  },
  join(id) {
    drop();
    room = id;
    channel = supabase
      .channel('room-' + id.replace(':', '-'))
      .on('broadcast', { event: 'changed' }, ({ payload }) => {
        if (!payload || payload.v > version) refresh();
      })
      .subscribe((status) => { live = status === 'SUBSCRIBED'; });
    refresh();
    heartbeat();
  },
  leave(id) {
    if (room !== id) return;
    drop();
    api('leave', { room: id }).catch(() => {});
  },
  async act(a, payload = {}) {
    const id = room;
    if (!id) return;
    try {
      apply(id, await api('act', { room: id, a, ...payload }));
    } catch (e) {
      if (e.status === 401 || e.offline) fail(e);
      if (e.status !== 401) emit('error', { message: e.message });
    }
  },
};
