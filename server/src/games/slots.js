import { randomInt } from 'node:crypto';
import { GameError, assertAmount, debit, credit, recordBet } from '../wallet.js';

// Слот 3×3, пять линий (три горизонтали и две диагонали). Ставка делится на 5 линий.
// Каждая ячейка выпадает независимо по весам; теоретический возврат ≈ 94%.
export const SYMBOLS = [
  { id: 'cherry', weight: 30, pays: 8 },
  { id: 'lemon', weight: 25, pays: 12 },
  { id: 'bell', weight: 18, pays: 25 },
  { id: 'star', weight: 13, pays: 60 },
  { id: 'diamond', weight: 9, pays: 150 },
  { id: 'seven', weight: 5, pays: 1200 },
];
const TOTAL_WEIGHT = SYMBOLS.reduce((s, x) => s + x.weight, 0);

// Линии заданы номером ряда для каждого из трёх барабанов.
export const LINES = [
  [0, 0, 0],
  [1, 1, 1],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
];

export const SLOT_BETS = [10, 25, 50, 100, 250, 500, 1000, 2500];

function pick() {
  let r = randomInt(TOTAL_WEIGHT);
  for (const s of SYMBOLS) {
    if (r < s.weight) return s;
    r -= s.weight;
  }
}

export function spin(bet) {
  const grid = [0, 1, 2].map(() => [0, 1, 2].map(() => pick())); // grid[барабан][ряд]
  const lineBet = bet / LINES.length;
  const wins = [];
  let payout = 0;
  LINES.forEach((line, i) => {
    const [a, b, c] = line.map((row, reel) => grid[reel][row]);
    if (a.id === b.id && b.id === c.id) {
      const amount = lineBet * a.pays;
      payout += amount;
      wins.push({ line: i, symbol: a.id, amount });
    }
  });
  return { grid: grid.map((reel) => reel.map((s) => s.id)), wins, payout };
}

export function createSlots(hub) {
  const feed = []; // последние спины всех игроков зала
  const lastSpin = new Map();

  return {
    id: 'slots',
    summary: () => ({ online: hub.members('slots').length }),
    view: () => ({ online: hub.members('slots').length, feed, bets: SLOT_BETS }),
    onAction(user, msg) {
      if (msg.a !== 'spin') return;
      const bet = msg.bet;
      assertAmount(bet);
      if (!SLOT_BETS.includes(bet)) throw new GameError('Недопустимая ставка');
      const now = Date.now();
      if (now - (lastSpin.get(user.id) || 0) < 900) throw new GameError('Слишком быстро');
      lastSpin.set(user.id, now);

      debit(user.id, bet);
      const result = spin(bet);
      // Выигрыш начисляется сразу, но клиенту баланс после спина приходит в результате,
      // чтобы он показал его после остановки барабанов.
      credit(user.id, result.payout);
      recordBet(user.id, 'slots', bet, result.payout, result.wins.length
        ? result.wins.map((w) => w.symbol).join(', ')
        : 'без выигрыша');
      hub.sendUser(user.id, { t: 'slots:result', bet, ...result });

      // В общую ленту спин попадает после анимации, чтобы не спойлерить результат.
      setTimeout(() => {
        feed.unshift({ id: now + ':' + user.id, userId: user.id, name: user.name, bet, payout: result.payout });
        feed.length = Math.min(feed.length, 20);
        hub.broadcast('slots');
      }, 1800);
    },
  };
}
