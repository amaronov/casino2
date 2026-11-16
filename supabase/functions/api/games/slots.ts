// deno-lint-ignore-file no-explicit-any
import { GameError, assertAmount, members, randomInt } from "../common.ts";

// Слот 3×3, пять линий. Каждая ячейка выпадает независимо по весам; возврат ≈ 94%.
export const SYMBOLS = [
  { id: "cherry", weight: 30, pays: 8 },
  { id: "lemon", weight: 25, pays: 12 },
  { id: "bell", weight: 18, pays: 25 },
  { id: "star", weight: 13, pays: 60 },
  { id: "diamond", weight: 9, pays: 150 },
  { id: "seven", weight: 5, pays: 1200 },
];
const TOTAL_WEIGHT = SYMBOLS.reduce((s, x) => s + x.weight, 0);
export const LINES = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]];
export const SLOT_BETS = [10, 25, 50, 100, 250, 500, 1000, 2500];

function pick() {
  let r = randomInt(TOTAL_WEIGHT);
  for (const s of SYMBOLS) {
    if (r < s.weight) return s;
    r -= s.weight;
  }
  return SYMBOLS[0];
}

export function spin(bet: number) {
  const grid = [0, 1, 2].map(() => [0, 1, 2].map(() => pick()));
  const lineBet = bet / LINES.length;
  const wins: any[] = [];
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

export const slots = {
  init: () => ({ feed: [], last: {} }),
  timers: {} as Record<string, any>,
  summary: (s: any, now: number) => ({ online: members(s, now).length }),
  view: (s: any, _uid: string, now: number) => ({ online: members(s, now).length, feed: s.feed, bets: SLOT_BETS }),
  async act(s: any, ctx: any, msg: any) {
    if (msg.a !== "spin") return;
    const { id, name } = ctx.user;
    const bet = msg.bet;
    assertAmount(bet);
    if (!SLOT_BETS.includes(bet)) throw new GameError("Недопустимая ставка");
    if (ctx.now - (s.last[id] || 0) < 900) throw new GameError("Слишком быстро");
    for (const k of Object.keys(s.last)) if (ctx.now - s.last[k] > 60_000) delete s.last[k];
    s.last[id] = ctx.now;

    await ctx.fx.debit(id, bet);
    const result = spin(bet);
    ctx.fx.credit(id, result.payout);
    ctx.fx.bet(id, "slots", bet, result.payout,
      result.wins.length ? result.wins.map((w) => w.symbol).join(", ") : "без выигрыша");
    s.feed.unshift({ id: ctx.now + ":" + id, userId: id, name, bet, payout: result.payout });
    s.feed.length = Math.min(s.feed.length, 20);
    ctx.reply = { t: "slots:result", bet, ...result };
  },
};
