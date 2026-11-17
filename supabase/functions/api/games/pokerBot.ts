// Решения покерного бота. Бот видит только то, что видел бы игрок: свои карты, стол,
// банк и ставки. Сила руки оценивается грубо, а случайный шум делает игру менее предсказуемой.
import { randomInt } from "../common.ts";
import { evaluate, RANKS } from "../cards.ts";

const rank = (c: string) => RANKS.indexOf(c[0]) + 2;
const rand = () => randomInt(1000) / 1000;

// Сила стартовой руки от 0 до ~0.95: пары, старшие карты, одномастность, связность.
function preflopStrength(cards: string[]): number {
  const [a, b] = cards.map(rank).sort((x, y) => y - x);
  if (a === b) return 0.5 + ((a - 2) / 12) * 0.45;
  let s = ((a + b) / 28) * 0.6;
  if (cards[0][1] === cards[1][1]) s += 0.06;
  const gap = a - b - 1;
  if (gap > 0) s -= 0.04 * Math.min(gap, 4);
  if (a === 14) s += 0.05;
  return Math.max(0, Math.min(0.9, s));
}

// Добавка за дро: четыре карты к флешу или к стриту.
function drawBonus(all: string[]): number {
  const bySuit: Record<string, number> = {};
  for (const c of all) bySuit[c[1]] = (bySuit[c[1]] || 0) + 1;
  const flushDraw = Object.values(bySuit).some((n) => n === 4);
  const vals = new Set(all.map(rank));
  if (vals.has(14)) vals.add(1);
  let straightDraw = false;
  for (let lo = 1; lo <= 10 && !straightDraw; lo++) {
    let n = 0;
    for (let v = lo; v < lo + 5; v++) if (vals.has(v)) n++;
    straightDraw = n === 4;
  }
  return (flushDraw ? 0.18 : 0) + (straightDraw ? 0.1 : 0);
}

// Сила руки после флопа. Комбинация, которая целиком лежит на столе, ценится низко.
function postflopStrength(cards: string[], board: string[]): number {
  const mine = evaluate([...cards, ...board]);
  const boardCat = evaluate(board)[0];
  const cat = mine[0];
  const high = Math.max(...cards.map(rank));
  let s: number;
  if (cat >= 4) s = cat > boardCat ? 0.85 + cat * 0.015 : 0.35;
  else if (cat === 3) s = boardCat >= 3 ? 0.3 : 0.8;
  else if (cat === 2) s = boardCat >= 2 ? 0.3 : boardCat === 1 ? 0.55 : 0.72;
  else if (cat === 1) {
    if (boardCat === 1) s = 0.18 + (high >= 12 ? 0.08 : 0);
    else {
      const pair = mine[1];
      const top = Math.max(...board.map(rank));
      s = pair >= top ? 0.58 + (pair - 2) * 0.008 : 0.4 - (top - pair) * 0.01;
    }
  } else s = 0.06 + ((high - 2) / 12) * 0.1;
  if (board.length < 5) s += drawBonus([...cards, ...board]) * (cat <= 1 ? 1 : 0.3);
  return Math.min(0.97, s);
}

export type BotInput = {
  cards: string[];
  board: string[];
  stack: number;
  bet: number;
  currentBet: number;
  minRaise: number;
  pot: number;
  bb: number;
};
export type BotChoice = { a: "fold" | "check" | "call" | "raise"; amount?: number };

export function decide(x: BotInput): BotChoice {
  const toCall = Math.min(x.currentBet - x.bet, x.stack);
  const base = x.board.length ? postflopStrength(x.cards, x.board) : preflopStrength(x.cards);
  const st = base + (rand() - 0.5) * 0.12;
  const maxTo = x.bet + x.stack;
  const canRaise = maxTo > x.currentBet;
  // Рейз на долю банка, округлённую до большого блайнда, но не меньше минимального.
  const raiseTo = (frac: number) => {
    const size = Math.max(x.minRaise, Math.round(((x.pot + toCall) * frac) / x.bb) * x.bb);
    return Math.min(maxTo, x.currentBet + size);
  };
  const r = rand();

  if (st > 0.72) {
    if (canRaise && r < 0.65) return { a: "raise", amount: raiseTo(0.5 + rand() * 0.5) };
    return { a: toCall > 0 ? "call" : "check" };
  }
  if (toCall === 0) {
    // Ставит со средней рукой иногда, а изредка блефует.
    if (canRaise && ((st > 0.5 && r < 0.4) || r < 0.07)) return { a: "raise", amount: raiseTo(0.4 + rand() * 0.3) };
    return { a: "check" };
  }
  // Префлоп без рейзов перед ботом: хорошие руки открываются рейзом, а не лимпом.
  if (!x.board.length && x.currentBet <= x.bb && st > 0.55 && canRaise && r < 0.7) {
    return { a: "raise", amount: Math.min(maxTo, x.bb * (2 + randomInt(3))) };
  }
  const odds = toCall / (x.pot + toCall);
  const bigPartOfStack = toCall > x.stack * 0.5;
  if (st > 0.45 && odds < st - 0.05 && !(bigPartOfStack && st < 0.62)) {
    if (canRaise && st > 0.62 && r < 0.15) return { a: "raise", amount: raiseTo(0.6) };
    return { a: "call" };
  }
  if (!x.board.length && toCall <= x.bb && st > 0.15) return { a: "call" }; // доплатить до блайнда
  if (odds < 0.15 && st > 0.25) return { a: "call" };
  return { a: "fold" };
}
