import { db } from './db.js';

// Все операции с балансом идут через этот модуль. better-sqlite3 синхронный,
// поэтому каждая операция атомарна в рамках одного процесса.

const listeners = new Set();
export const onBalance = (fn) => listeners.add(fn);
const emit = (userId) => {
  const balance = getBalance(userId);
  for (const fn of listeners) fn(userId, balance);
};

const qBalance = db.prepare('SELECT balance FROM users WHERE id = ?');
const qDebit = db.prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?');
const qCredit = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
const qBet = db.prepare(
  'INSERT INTO bets (user_id, game, amount, payout, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
);

export class GameError extends Error {}

export function getBalance(userId) {
  return qBalance.get(userId)?.balance ?? 0;
}

export function assertAmount(amount, min = 1, max = 1_000_000) {
  if (!Number.isInteger(amount) || amount < min) throw new GameError(`Минимальная ставка — ${min}`);
  if (amount > max) throw new GameError(`Максимальная ставка — ${max}`);
}

export function debit(userId, amount) {
  assertAmount(amount);
  const r = qDebit.run(amount, userId, amount);
  if (r.changes !== 1) throw new GameError('Недостаточно фишек');
  emit(userId);
}

export function credit(userId, amount) {
  if (!Number.isInteger(amount) || amount < 0) throw new Error('bad credit');
  if (amount === 0) return;
  qCredit.run(amount, userId);
  emit(userId);
}

export function recordBet(userId, game, amount, payout, detail = '') {
  qBet.run(userId, game, amount, payout, detail, Date.now());
}
