import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(here, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'casino.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    balance       INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    last_bonus_at INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    game       TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    payout     INTEGER NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bets_user ON bets(user_id, id DESC);
  -- Фишки, которые сейчас лежат на покерных столах. Возвращаются на баланс при рестарте сервера.
  CREATE TABLE IF NOT EXISTS poker_stacks (
    user_id  INTEGER NOT NULL REFERENCES users(id),
    table_id TEXT NOT NULL,
    stack    INTEGER NOT NULL,
    PRIMARY KEY (user_id, table_id)
  );
`);

// Секрет для подписи токенов: из окружения или сохранённый рядом с базой.
const secretFile = path.join(DATA_DIR, 'jwt.secret');
export const JWT_SECRET =
  process.env.JWT_SECRET ||
  (existsSync(secretFile)
    ? readFileSync(secretFile, 'utf8')
    : (() => {
        const s = randomBytes(48).toString('hex');
        writeFileSync(secretFile, s, { mode: 0o600 });
        return s;
      })());
