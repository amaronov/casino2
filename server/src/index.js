import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { db } from './db.js';
import {
  register, login, signToken, userFromToken, getUser, publicUser, validName,
  AuthError, DAILY_BONUS, BONUS_INTERVAL,
} from './auth.js';
import { credit } from './wallet.js';
import { createHub } from './hub.js';
import { createSlots, SYMBOLS, LINES } from './games/slots.js';
import { createRoulette } from './games/roulette.js';
import { createBlackjackTable } from './games/blackjack.js';
import { createPokerTable, refundOrphanStacks } from './games/poker.js';

const PORT = Number(process.env.PORT) || 3001;
const here = path.dirname(fileURLToPath(import.meta.url));

// ── Комнаты ──────────────────────────────────────────────────────────────────
refundOrphanStacks();
const hub = createHub();
const slots = hub.register(createSlots(hub));
const roulette = hub.register(createRoulette(hub));
const bjTables = [
  { id: 'bj:1', name: 'Новичок', min: 10, max: 1_000 },
  { id: 'bj:2', name: 'Классика', min: 100, max: 10_000 },
  { id: 'bj:3', name: 'Хайроллер', min: 500, max: 50_000 },
].map((cfg) => hub.register(createBlackjackTable(hub, cfg)));
const pokerTables = [
  { id: 'poker:1', name: 'Микро', sb: 5, bb: 10 },
  { id: 'poker:2', name: 'Средний', sb: 25, bb: 50 },
  { id: 'poker:3', name: 'Высокий', sb: 100, bb: 200 },
].map((cfg) => hub.register(createPokerTable(hub, cfg)));

// ── HTTP API ─────────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));

// Ограничение частоты попыток входа и регистрации: 15 в минуту с одного адреса.
const attempts = new Map();
function authLimit(req, res, next) {
  const now = Date.now();
  const a = attempts.get(req.ip);
  if (!a || now - a.start > 60_000) attempts.set(req.ip, { start: now, n: 1 });
  else if (++a.n > 15) return res.status(429).json({ error: 'Слишком много попыток, подождите минуту' });
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, a] of attempts) if (now - a.start > 60_000) attempts.delete(ip);
}, 60_000).unref();

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const user = userFromToken(token);
  if (!user) return res.status(401).json({ error: 'Требуется вход' });
  req.user = user;
  next();
}

app.post('/api/auth/register', authLimit, (req, res) => {
  const user = register(req.body.username, req.body.password, req.body.displayName);
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.post('/api/auth/login', authLimit, (req, res) => {
  const user = login(req.body.username, req.body.password);
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.patch('/api/me', auth, (req, res) => {
  const name = validName(req.body.displayName);
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, req.user.id);
  hub.rename(req.user.id, name);
  res.json({ user: publicUser(getUser(req.user.id)) });
});

app.post('/api/bonus', auth, (req, res) => {
  const now = Date.now();
  // Условие в самом запросе не даёт получить бонус дважды.
  const r = db
    .prepare('UPDATE users SET last_bonus_at = ? WHERE id = ? AND last_bonus_at <= ?')
    .run(now, req.user.id, now - BONUS_INTERVAL);
  if (r.changes !== 1) return res.status(400).json({ error: 'Бонус пока недоступен' });
  credit(req.user.id, DAILY_BONUS);
  res.json({ user: publicUser(getUser(req.user.id)), bonus: DAILY_BONUS });
});

app.get('/api/history', auth, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const items = db
    .prepare('SELECT id, game, amount, payout, detail, created_at AS createdAt FROM bets WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(req.user.id, limit, offset);
  const stats = db
    .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS wagered, COALESCE(SUM(payout), 0) AS won,
                     COALESCE(MAX(payout - amount), 0) AS biggestWin
              FROM bets WHERE user_id = ?`)
    .get(req.user.id);
  res.json({ items, stats });
});

const BOARDS = {
  // Фишки на покерных столах тоже считаются частью баланса.
  balance: `SELECT u.id, u.display_name AS name,
              u.balance + COALESCE((SELECT SUM(stack) FROM poker_stacks p WHERE p.user_id = u.id), 0) AS value
            FROM users u ORDER BY value DESC, u.id`,
  win: `SELECT u.id, u.display_name AS name, MAX(b.payout - b.amount) AS value
        FROM bets b JOIN users u ON u.id = b.user_id GROUP BY u.id HAVING value > 0 ORDER BY value DESC, u.id`,
  profit: `SELECT u.id, u.display_name AS name, SUM(b.payout - b.amount) AS value
           FROM bets b JOIN users u ON u.id = b.user_id GROUP BY u.id ORDER BY value DESC, u.id`,
};
app.get('/api/leaderboard', auth, (req, res) => {
  const sql = BOARDS[req.query.by] || BOARDS.balance;
  const rows = db.prepare(sql).all().map((r, i) => ({ ...r, rank: i + 1 }));
  res.json({ top: rows.slice(0, 50), me: rows.find((r) => r.id === req.user.id) || null });
});

app.get('/api/lobby', auth, (_req, res) => {
  res.json({
    slots: slots.summary(),
    roulette: roulette.summary(),
    blackjack: bjTables.map((t) => t.summary()),
    poker: pokerTables.map((t) => t.summary()),
  });
});

app.get('/api/slots/paytable', (_req, res) => {
  res.json({ symbols: SYMBOLS.map(({ id, pays }) => ({ id, pays })), lines: LINES });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Не найдено' }));

// Собранный клиент (npm run build) отдаётся тем же сервером.
const dist = path.join(here, '..', '..', 'client', 'dist');
if (existsSync(dist)) app.use(express.static(dist));

app.use((err, _req, res, _next) => {
  if (err instanceof AuthError) return res.status(400).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный запрос' });
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// ── WebSocket ────────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws) => hub.attach(ws));

server.listen(PORT, () => console.log(`Казино запущено: http://localhost:${PORT}`));
