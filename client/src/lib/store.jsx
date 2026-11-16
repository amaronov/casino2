import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { socket, clockOffset } from './socket.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const [balance, setBalanceState] = useState(0);
  const [online, setOnline] = useState(false);
  const [toasts, setToasts] = useState([]);

  // Баланс можно «придержать» на время анимации (слоты), чтобы не спойлерить результат.
  const hold = useRef({ held: false, pending: null });
  const setBalance = useCallback((value) => {
    if (hold.current.held) hold.current.pending = value;
    else setBalanceState(value);
  }, []);
  const holdBalance = useCallback((held, show) => {
    hold.current.held = held;
    if (held && show != null) setBalanceState(show);
    if (!held && hold.current.pending != null) {
      setBalanceState(hold.current.pending);
      hold.current.pending = null;
    }
  }, []);

  const toast = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const applyUser = useCallback((u) => {
    setUser(u);
    if (u) setBalance(u.balance);
  }, [setBalance]);

  const signIn = useCallback((token, u) => {
    setToken(token);
    applyUser(u);
    socket.connect();
  }, [applyUser]);

  const signOut = useCallback(() => {
    socket.disconnect();
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    const offs = [
      socket.on('balance', (m) => setBalance(m.balance)),
      socket.on('status', (m) => setOnline(m.online)),
      socket.on('error', (m) => toast(m.message, 'error')),
      socket.on('toast', (m) => toast(m.message)),
      socket.on('unauthorized', () => signOut()),
    ];
    if (getToken()) {
      api('me')
        .then((r) => { applyUser(r.user); socket.connect(); })
        .catch((e) => { if (e.status === 401) setToken(null); })
        .finally(() => setLoading(false));
    }
    return () => offs.forEach((off) => off());
  }, [applyUser, setBalance, signOut, toast]);

  return (
    <Ctx.Provider value={{ user, setUser: applyUser, loading, balance, online, holdBalance, toast, toasts, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

// Подписка на комнату: входит при монтировании, выходит при размонтировании.
export function useRoom(roomId) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!roomId) return;
    setState(null);
    const off = socket.on('state', (m) => m.room === roomId && setState(m.state));
    socket.join(roomId);
    return () => {
      off();
      socket.leave(roomId);
    };
  }, [roomId]);
  return state;
}

// Секунды до серверного момента endsAt с поправкой на расхождение часов.
export function useCountdown(endsAt) {
  const calc = () => (endsAt ? Math.max(0, endsAt - (Date.now() + clockOffset)) : 0);
  const [ms, setMs] = useState(calc);
  useEffect(() => {
    setMs(calc());
    if (!endsAt) return;
    const t = setInterval(() => setMs(calc()), 200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);
  return ms;
}

export function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}
export const go = (path) => { window.location.hash = '#/' + path; };

export const fmt = (n) => Math.round(n ?? 0).toLocaleString('ru-RU');
export const compact = (n) =>
  n >= 1_000_000 ? +(n / 1_000_000).toFixed(1) + 'M' : n >= 1000 ? +(n / 1000).toFixed(1) + 'K' : String(n);
