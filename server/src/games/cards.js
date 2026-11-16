import { randomInt } from 'node:crypto';

// Карта — строка из двух символов: достоинство + масть, например "As", "Td", "7h".
export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

export function newDeck(decks = 1) {
  const deck = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  // Тасование Фишера — Йетса на криптостойком генераторе.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ── Блекджек ────────────────────────────────────────────────────────────────
export function bjValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c === '??') continue;
    const r = c[0];
    if (r === 'A') { aces++; total += 11; }
    else total += 'TJQK'.includes(r) ? 10 : Number(r);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

// ── Покер: оценка лучшей комбинации из 5–7 карт ─────────────────────────────
export const HAND_NAMES = [
  'Старшая карта', 'Пара', 'Две пары', 'Сет', 'Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш',
];

function straightHigh(values) {
  const u = [...new Set(values)].sort((a, b) => b - a);
  if (u[0] === 14) u.push(1); // туз снизу: A-2-3-4-5
  let run = 1;
  for (let i = 1; i < u.length; i++) {
    if (u[i] === u[i - 1] - 1) {
      run++;
      if (run >= 5) return u[i] + 4;
    } else run = 1;
  }
  return 0;
}

// Возвращает массив [категория, ...кикеры], сравнимый лексикографически.
export function evaluate(cards) {
  const rs = cards.map((c) => RANKS.indexOf(c[0]) + 2);
  const bySuit = {};
  cards.forEach((c, i) => (bySuit[c[1]] ??= []).push(rs[i]));
  const flush = Object.values(bySuit).find((v) => v.length >= 5);
  if (flush) {
    const sf = straightHigh(flush);
    if (sf) return [8, sf];
  }
  const counts = new Map();
  rs.forEach((r) => counts.set(r, (counts.get(r) || 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const kick = (exclude, n) =>
    [...counts.keys()].filter((r) => !exclude.includes(r)).sort((a, b) => b - a).slice(0, n);
  const [g0, g1] = groups;
  if (g0[1] === 4) return [7, g0[0], ...kick([g0[0]], 1)];
  if (g0[1] === 3 && g1 && g1[1] >= 2) return [6, g0[0], g1[0]];
  if (flush) return [5, ...flush.sort((a, b) => b - a).slice(0, 5)];
  const st = straightHigh(rs);
  if (st) return [4, st];
  if (g0[1] === 3) return [3, g0[0], ...kick([g0[0]], 2)];
  if (g0[1] === 2 && g1 && g1[1] === 2) return [2, g0[0], g1[0], ...kick([g0[0], g1[0]], 1)];
  if (g0[1] === 2) return [1, g0[0], ...kick([g0[0]], 3)];
  return [0, ...kick([], 5)];
}

export function compareHands(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
