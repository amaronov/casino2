import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, JWT_SECRET } from './db.js';

export const START_BALANCE = 10_000;
export const DAILY_BONUS = 2_500;
export const BONUS_INTERVAL = 24 * 60 * 60 * 1000;

const qByName = db.prepare('SELECT * FROM users WHERE username = ?');
const qById = db.prepare('SELECT * FROM users WHERE id = ?');
const qInsert = db.prepare(
  'INSERT INTO users (username, display_name, password_hash, balance, created_at) VALUES (?, ?, ?, ?, ?)'
);

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export class AuthError extends Error {}

export function validName(name) {
  const s = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > 20) throw new AuthError('Имя — от 2 до 20 символов');
  return s;
}

export function register(username, password, displayName) {
  username = String(username ?? '').trim();
  password = String(password ?? '');
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username))
    throw new AuthError('Логин — 3–16 символов: латиница, цифры, подчёркивание');
  if (password.length < 6 || password.length > 72) throw new AuthError('Пароль — от 6 символов');
  const name = validName(displayName || username);
  if (qByName.get(username)) throw new AuthError('Этот логин уже занят');
  const info = qInsert.run(username, name, hashPassword(password), START_BALANCE, Date.now());
  return qById.get(info.lastInsertRowid);
}

export function login(username, password) {
  const user = qByName.get(String(username ?? '').trim());
  if (!user || !verifyPassword(String(password ?? ''), user.password_hash))
    throw new AuthError('Неверный логин или пароль');
  return user;
}

export const signToken = (user) => jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '30d' });

export function userFromToken(token) {
  try {
    const { uid } = jwt.verify(String(token), JWT_SECRET);
    return qById.get(uid) || null;
  } catch {
    return null;
  }
}

export const getUser = (id) => qById.get(id);

export const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  balance: u.balance,
  createdAt: u.created_at,
  nextBonusAt: u.last_bonus_at + BONUS_INTERVAL,
});
