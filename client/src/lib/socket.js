import { API_BASE, getToken } from './api.js';

// Одно WebSocket-соединение на приложение: авторизация, автопереподключение,
// повторный вход в текущую комнату после обрыва.
function wsUrl() {
  const base = API_BASE || location.origin;
  return base.replace(/^http/, 'ws') + '/ws';
}

const handlers = new Map(); // тип сообщения -> Set обработчиков
let ws = null;
let ready = false;
let room = null;
let wanted = false;
let retry = 0;
let retryTimer = null;
// Разница между часами сервера и клиента — для точных таймеров.
export let clockOffset = 0;

function emit(type, msg) {
  handlers.get(type)?.forEach((fn) => fn(msg));
}

function open() {
  clearTimeout(retryTimer);
  if (!wanted || !getToken()) return;
  ws = new WebSocket(wsUrl());
  const sock = ws;
  sock.onopen = () => sock.send(JSON.stringify({ t: 'auth', token: getToken() }));
  sock.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.t === 'ready') {
      ready = true;
      retry = 0;
      emit('status', { online: true });
      if (room) sock.send(JSON.stringify({ t: 'join', room }));
    }
    if (msg.t === 'state' && msg.state?.now) clockOffset = msg.state.now - Date.now();
    emit(msg.t, msg);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ready = false;
    ws = null;
    emit('status', { online: false });
    if (wanted) retryTimer = setTimeout(open, Math.min(500 * 2 ** retry++, 8000));
  };
}

export const socket = {
  connect() {
    wanted = true;
    if (!ws) open();
  },
  disconnect() {
    wanted = false;
    room = null;
    ready = false;
    clearTimeout(retryTimer);
    ws?.close();
    ws = null;
  },
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type).delete(fn);
  },
  send(msg) {
    if (ready && ws?.readyState === 1) ws.send(JSON.stringify(msg));
    else emit('error', { message: 'Нет соединения с сервером' });
  },
  join(id) {
    room = id;
    if (ready) ws.send(JSON.stringify({ t: 'join', room: id }));
  },
  leave(id) {
    if (room !== id) return;
    room = null;
    if (ready) ws.send(JSON.stringify({ t: 'leave' }));
  },
  act(a, payload = {}) {
    socket.send({ t: 'act', a, ...payload });
  },
};
