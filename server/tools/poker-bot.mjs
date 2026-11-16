// Тестовый соперник для покера: регистрирует случайный аккаунт, садится за стол
// и всегда отвечает чеком или коллом. Нужен, чтобы проверить покер в одиночку.
// Запуск (сервер должен работать):  node server/tools/poker-bot.mjs [стол] [место]
import WebSocket from 'ws';

const BASE = process.env.URL || 'http://localhost:3001';
const table = process.argv[2] || 'poker:1';
const seat = Number(process.argv[3] ?? 4);
const rnd = () => Math.random().toString(36).slice(2, 10);

const res = await fetch(BASE + '/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'bot_' + rnd(), password: rnd() + rnd(), displayName: 'Бот Борис' }),
}).then((r) => r.json());
if (!res.token) throw new Error(res.error || 'не удалось зарегистрировать бота');

const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
const send = (msg) => ws.send(JSON.stringify(msg));
ws.on('open', () => send({ t: 'auth', token: res.token }));
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'ready') {
    send({ t: 'join', room: table });
    setTimeout(() => send({ t: 'act', a: 'sit', seat, buyIn: m.balance >= 1000 ? 1000 : 200 }), 300);
  }
  if (m.t === 'state' && m.state.mySeat >= 0 && m.state.turn === m.state.mySeat) {
    const me = m.state.seats[m.state.mySeat];
    setTimeout(() => send({ t: 'act', a: me.bet === m.state.currentBet ? 'check' : 'call' }), 1200);
  }
  if (m.t === 'error') console.log('Ошибка:', m.message);
});
ws.on('close', () => process.exit(0));
console.log(`Бот сел за стол ${table}, место ${seat + 1}. Ctrl+C — выйти.`);
