import { randomInt } from 'node:crypto';
import { GameError, assertAmount, debit, credit, recordBet } from '../wallet.js';

// Европейская рулетка, один общий стол. Раунды идут по таймеру, пока за столом кто-то есть.
const BETTING_MS = 20_000;
const SPIN_MS = 7_000;
const RESULT_MS = 5_000;
const MAX_ROUND_TOTAL = 50_000;

export const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// Множитель выплаты (вместе со ставкой) или 0, если ставка не сыграла.
function multiplier(key, n) {
  const [kind, arg] = key.split(':');
  const v = Number(arg);
  switch (kind) {
    case 'n': return v === n ? 36 : 0;
    case 'red': return n > 0 && REDS.has(n) ? 2 : 0;
    case 'black': return n > 0 && !REDS.has(n) ? 2 : 0;
    case 'even': return n > 0 && n % 2 === 0 ? 2 : 0;
    case 'odd': return n % 2 === 1 ? 2 : 0;
    case 'low': return n >= 1 && n <= 18 ? 2 : 0;
    case 'high': return n >= 19 ? 2 : 0;
    case 'd': return n > 0 && Math.ceil(n / 12) === v ? 3 : 0;
    case 'c': return n > 0 && ((n - 1) % 3) + 1 === v ? 3 : 0;
    default: return 0;
  }
}

function validKey(key) {
  if (typeof key !== 'string') return false;
  if (['red', 'black', 'even', 'odd', 'low', 'high'].includes(key)) return true;
  const m = /^(n|d|c):(\d{1,2})$/.exec(key);
  if (!m) return false;
  const v = Number(m[2]);
  return m[1] === 'n' ? v <= 36 : v >= 1 && v <= 3;
}

export function createRoulette(hub) {
  const id = 'roulette';
  const s = { phase: 'idle', endsAt: null, result: null, history: [] };
  let players = new Map(); // userId -> { name, bets: Map<key, amount>, total, payout }
  let timer = null;

  const schedule = (ms, fn) => {
    clearTimeout(timer);
    s.endsAt = Date.now() + ms;
    timer = setTimeout(fn, ms);
  };

  function startBetting() {
    players = new Map();
    s.phase = 'betting';
    s.result = null;
    schedule(BETTING_MS, startSpin);
    hub.broadcast(id);
  }

  function startSpin() {
    if (players.size === 0 && hub.members(id).length === 0) return goIdle();
    s.phase = 'spinning';
    s.result = randomInt(37);
    schedule(SPIN_MS, settle);
    hub.broadcast(id);
  }

  function settle() {
    const n = s.result;
    for (const [userId, p] of players) {
      let payout = 0;
      for (const [key, amount] of p.bets) payout += amount * multiplier(key, n);
      p.payout = payout;
      credit(userId, payout);
      recordBet(userId, 'roulette', p.total, payout, `выпало ${n}`);
    }
    s.history.unshift(n);
    s.history.length = Math.min(s.history.length, 14);
    s.phase = 'result';
    schedule(RESULT_MS, () => (hub.members(id).length ? startBetting() : goIdle()));
    hub.broadcast(id);
  }

  function goIdle() {
    clearTimeout(timer);
    players = new Map();
    s.phase = 'idle';
    s.endsAt = null;
  }

  return {
    id,
    summary: () => ({ online: hub.members(id).length }),
    onJoin() {
      if (s.phase === 'idle') startBetting();
    },
    view(userId) {
      const me = players.get(userId);
      return {
        phase: s.phase,
        endsAt: s.endsAt,
        now: Date.now(),
        // Число раскрывается в момент запуска колеса — ставки к этому времени закрыты.
        result: s.phase === 'betting' ? null : s.result,
        history: s.history,
        online: hub.members(id).length,
        players: [...players.entries()].map(([pid, p]) => ({
          id: pid,
          name: p.name,
          total: p.total,
          payout: s.phase === 'result' ? p.payout : null,
        })),
        myBets: me ? Object.fromEntries(me.bets) : {},
        myTotal: me?.total ?? 0,
        myPayout: s.phase === 'result' ? me?.payout ?? null : null,
        maxTotal: MAX_ROUND_TOTAL,
      };
    },
    onAction(user, msg) {
      if (s.phase !== 'betting') throw new GameError('Ставки закрыты');
      if (msg.a === 'bet') {
        if (!validKey(msg.key)) throw new GameError('Недопустимая ставка');
        assertAmount(msg.amount, 10);
        const p = players.get(user.id) || { name: user.name, bets: new Map(), total: 0, payout: 0 };
        if (p.total + msg.amount > MAX_ROUND_TOTAL)
          throw new GameError(`Лимит стола — ${MAX_ROUND_TOTAL} за раунд`);
        debit(user.id, msg.amount);
        p.bets.set(msg.key, (p.bets.get(msg.key) || 0) + msg.amount);
        p.total += msg.amount;
        players.set(user.id, p);
      } else if (msg.a === 'clear') {
        const p = players.get(user.id);
        if (!p) return;
        players.delete(user.id);
        credit(user.id, p.total);
      } else return;
      hub.broadcast(id);
    },
  };
}
