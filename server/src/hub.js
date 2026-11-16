import { userFromToken } from './auth.js';
import { GameError, onBalance } from './wallet.js';

// Хаб реального времени: сокеты, комнаты и рассылка состояния.
// Комната — объект { id, view(userId), onAction(user, msg), onJoin?(user), onLeave?(user) }.

const GRACE_MS = 20_000; // сколько ждём переподключения, прежде чем считать, что игрок ушёл

export function createHub() {
  const rooms = new Map();
  const socks = new Map(); // ws -> { user, room, msgs, windowStart }
  const pending = new Map(); // `${room}:${userId}` -> timer

  const send = (ws, msg) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  };

  const inRoom = (roomId, userId) => {
    for (const c of socks.values()) if (c.room === roomId && c.user?.id === userId) return true;
    return false;
  };

  function leaveRoom(ws, immediate) {
    const c = socks.get(ws);
    const roomId = c?.room;
    if (!roomId) return;
    c.room = null;
    const room = rooms.get(roomId);
    const user = c.user;
    if (!inRoom(roomId, user.id)) {
      const key = `${roomId}:${user.id}`;
      const gone = () => {
        pending.delete(key);
        if (inRoom(roomId, user.id)) return;
        try { room.onLeave?.(user); } catch (e) { console.error(e); }
        hub.broadcast(roomId);
      };
      if (immediate) gone();
      else pending.set(key, setTimeout(gone, GRACE_MS));
    }
    hub.broadcast(roomId);
  }

  const hub = {
    register(room) {
      rooms.set(room.id, room);
      return room;
    },
    rooms,
    members(roomId) {
      const m = new Map();
      for (const c of socks.values()) if (c.room === roomId) m.set(c.user.id, c.user);
      return [...m.values()];
    },
    broadcast(roomId) {
      const room = rooms.get(roomId);
      if (!room) return;
      for (const [ws, c] of socks)
        if (c.room === roomId) send(ws, { t: 'state', room: roomId, state: room.view(c.user.id) });
    },
    sendUser(userId, msg) {
      for (const [ws, c] of socks) if (c.user?.id === userId) send(ws, msg);
    },
    rename(userId, name) {
      for (const c of socks.values()) if (c.user?.id === userId) c.user.name = name;
    },
    attach(ws) {
      const c = { user: null, room: null, msgs: 0, windowStart: Date.now() };
      socks.set(ws, c);

      ws.on('message', (raw) => {
        // Простейшая защита от флуда: не больше 30 сообщений в секунду с сокета.
        const now = Date.now();
        if (now - c.windowStart > 1000) { c.windowStart = now; c.msgs = 0; }
        if (++c.msgs > 30) return;

        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (!msg || typeof msg !== 'object') return;

        if (msg.t === 'auth') {
          const u = userFromToken(msg.token);
          if (!u) return send(ws, { t: 'unauthorized' });
          c.user = { id: u.id, name: u.display_name };
          return send(ws, { t: 'ready', balance: u.balance });
        }
        if (!c.user) return send(ws, { t: 'unauthorized' });

        try {
          if (msg.t === 'join') {
            const room = rooms.get(msg.room);
            if (!room) throw new GameError('Комната не найдена');
            if (c.room === room.id) return hub.broadcast(room.id);
            leaveRoom(ws, true);
            c.room = room.id;
            const key = `${room.id}:${c.user.id}`;
            clearTimeout(pending.get(key));
            pending.delete(key);
            room.onJoin?.(c.user);
            hub.broadcast(room.id);
          } else if (msg.t === 'leave') {
            leaveRoom(ws, true);
          } else if (msg.t === 'act') {
            const room = rooms.get(c.room);
            if (!room) throw new GameError('Вы не в комнате');
            room.onAction(c.user, msg);
          }
        } catch (e) {
          if (e instanceof GameError) send(ws, { t: 'error', message: e.message });
          else {
            console.error(e);
            send(ws, { t: 'error', message: 'Внутренняя ошибка' });
          }
        }
      });

      ws.on('close', () => {
        if (c.user) leaveRoom(ws, false);
        socks.delete(ws);
      });
      ws.on('error', () => {});
    },
  };

  onBalance((userId, balance) => hub.sendUser(userId, { t: 'balance', balance }));
  return hub;
}
