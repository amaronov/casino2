// deno-lint-ignore-file no-explicit-any
import { GameError, assertAmount, members, randomInt, schedule } from "../common.ts";

// Европейская рулетка, один общий стол. Раунды идут, пока за столом кто-то есть.
const BETTING_MS = 20_000;
const SPIN_MS = 7_000;
const RESULT_MS = 5_000;
const MAX_ROUND_TOTAL = 50_000;
const STALE_MS = 40_000; // если срок прошёл так давно, значит стол был пуст

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// Множитель выплаты (вместе со ставкой) или 0, если ставка не сыграла.
function multiplier(key: string, n: number): number {
  const [kind, arg] = key.split(":");
  const v = Number(arg);
  switch (kind) {
    case "n": return v === n ? 36 : 0;
    case "red": return n > 0 && REDS.has(n) ? 2 : 0;
    case "black": return n > 0 && !REDS.has(n) ? 2 : 0;
    case "even": return n > 0 && n % 2 === 0 ? 2 : 0;
    case "odd": return n % 2 === 1 ? 2 : 0;
    case "low": return n >= 1 && n <= 18 ? 2 : 0;
    case "high": return n >= 19 ? 2 : 0;
    case "d": return n > 0 && Math.ceil(n / 12) === v ? 3 : 0;
    case "c": return n > 0 && ((n - 1) % 3) + 1 === v ? 3 : 0;
    default: return 0;
  }
}

function validKey(key: any): boolean {
  if (typeof key !== "string") return false;
  if (["red", "black", "even", "odd", "low", "high"].includes(key)) return true;
  const m = /^(n|d|c):(\d{1,2})$/.exec(key);
  if (!m) return false;
  const v = Number(m[2]);
  return m[1] === "n" ? v <= 36 : v >= 1 && v <= 3;
}

const empty = (s: any, ctx: any) => ctx.realNow - ctx.now > STALE_MS || members(s, ctx.realNow).length === 0;

function startBetting(s: any, ctx: any) {
  s.players = {};
  s.phase = "betting";
  s.result = null;
  s.endsAt = schedule(s, ctx, BETTING_MS, "spin");
}

function goIdle(s: any) {
  s.players = {};
  s.phase = "idle";
  s.endsAt = null;
  s.timer = null;
}

export const roulette = {
  init: () => ({ phase: "idle", endsAt: null, result: null, history: [], players: {} }),
  // Первый вошедший за пустой стол запускает раунд.
  pre(s: any, ctx: any) {
    if (s.phase === "idle" && members(s, ctx.now).length) startBetting(s, ctx);
  },
  timers: {
    spin(s: any, ctx: any) {
      if (Object.keys(s.players).length === 0 && empty(s, ctx)) return goIdle(s);
      s.phase = "spinning";
      s.result = randomInt(37);
      s.endsAt = schedule(s, ctx, SPIN_MS, "settle");
    },
    settle(s: any, ctx: any) {
      const n = s.result;
      for (const [uid, p] of Object.entries<any>(s.players)) {
        let payout = 0;
        for (const [key, amount] of Object.entries<number>(p.bets)) payout += amount * multiplier(key, n);
        p.payout = payout;
        ctx.fx.credit(uid, payout);
        ctx.fx.bet(uid, "roulette", p.total, payout, `выпало ${n}`);
      }
      s.history.unshift(n);
      s.history.length = Math.min(s.history.length, 14);
      s.phase = "result";
      s.endsAt = schedule(s, ctx, RESULT_MS, "next");
    },
    next(s: any, ctx: any) {
      if (empty(s, ctx)) goIdle(s);
      else startBetting(s, ctx);
    },
  } as Record<string, any>,
  summary: (s: any, now: number) => ({ online: members(s, now).length }),
  view(s: any, uid: string, now: number) {
    const me = s.players[uid];
    const done = s.phase === "result";
    return {
      phase: s.phase,
      endsAt: s.endsAt,
      // Число раскрывается в момент запуска колеса — ставки к этому времени закрыты.
      result: s.phase === "betting" ? null : s.result,
      history: s.history,
      online: members(s, now).length,
      players: Object.entries<any>(s.players).map(([id, p]) => ({
        id, name: p.name, total: p.total, payout: done ? p.payout : null,
      })),
      myBets: me ? me.bets : {},
      myTotal: me?.total ?? 0,
      myPayout: done ? me?.payout ?? null : null,
      maxTotal: MAX_ROUND_TOTAL,
    };
  },
  async act(s: any, ctx: any, msg: any) {
    if (s.phase !== "betting") throw new GameError("Ставки закрыты");
    const { id, name } = ctx.user;
    if (msg.a === "bet") {
      if (!validKey(msg.key)) throw new GameError("Недопустимая ставка");
      assertAmount(msg.amount, 10);
      const p = s.players[id] || { name, bets: {}, total: 0, payout: 0 };
      if (p.total + msg.amount > MAX_ROUND_TOTAL) throw new GameError(`Лимит стола — ${MAX_ROUND_TOTAL} за раунд`);
      await ctx.fx.debit(id, msg.amount);
      p.bets[msg.key] = (p.bets[msg.key] || 0) + msg.amount;
      p.total += msg.amount;
      s.players[id] = p;
    } else if (msg.a === "clear") {
      const p = s.players[id];
      if (!p) return;
      delete s.players[id];
      ctx.fx.credit(id, p.total);
    }
  },
};
