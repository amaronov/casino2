// Тестовый соперник для покера: регистрирует случайный аккаунт, садится за стол
// и всегда отвечает чеком или коллом. Нужен, чтобы проверить покер в одиночку.
// Запуск:  node tools/poker-bot.mjs [стол] [место]     Ctrl+C — бот встаёт из-за стола.
// Внимание: бот создаёт настоящего игрока в базе (он появится в лидерборде).
const URL = 'https://pkiiuuhnhsujypxixdzj.supabase.co/functions/v1/api';
const KEY = 'sb_publishable_-lrzLSCvguRb0hZiyVMFEQ_NpJ9TpCA';
const room = process.argv[2] || 'poker:1';
const seat = Number(process.argv[3] ?? 4);
const rnd = () => Math.random().toString(36).slice(2, 10);

let token = null;
const call = (op, body = {}) =>
  fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: KEY, ...(token ? { 'x-casino-token': token } : {}) },
    body: JSON.stringify({ op, ...body }),
  }).then((r) => r.json());

const reg = await call('register', { username: 'bot_' + rnd(), password: rnd() + rnd(), displayName: 'Бот Борис' });
if (!reg.token) throw new Error(reg.error || 'не удалось зарегистрировать бота');
token = reg.token;

const sat = await call('act', { room, a: 'sit', seat, buyIn: 1000 });
if (sat.error) throw new Error(sat.error);
console.log(`Бот сел за стол ${room}, место ${seat + 1}. Ctrl+C — выйти.`);

let running = true;
process.on('SIGINT', async () => {
  running = false;
  await call('leave', { room });
  process.exit(0);
});

while (running) {
  const { state, error } = await call('room', { room });
  if (error) { console.log('Ошибка:', error); break; }
  if (state.mySeat < 0) { console.log('Бот больше не за столом.'); break; }
  if (state.turn === state.mySeat) {
    const me = state.seats[state.mySeat];
    await new Promise((r) => setTimeout(r, 1000));
    await call('act', { room, a: me.bet === state.currentBet ? 'check' : 'call' });
  } else await new Promise((r) => setTimeout(r, 1500));
}
