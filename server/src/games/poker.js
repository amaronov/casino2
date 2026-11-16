import { db } from '../db.js';
import { GameError, debit, credit, recordBet } from '../wallet.js';
import { newDeck, evaluate, compareHands, HAND_NAMES } from './cards.js';

// Безлимитный техасский холдем, до 6 игроков за столом.
// Фишки садятся на стол из баланса (бай-ин) и возвращаются на баланс при выходе.
const MAX_SEATS = 6;
const TURN_MS = 25_000;
const RUNOUT_MS = 1_300;

const qSave = db.prepare('INSERT OR REPLACE INTO poker_stacks (user_id, table_id, stack) VALUES (?, ?, ?)');
const qDrop = db.prepare('DELETE FROM poker_stacks WHERE user_id = ? AND table_id = ?');

// После падения сервера незавершённые раздачи аннулируются: стеки возвращаются на баланс.
export function refundOrphanStacks() {
  const rows = db.prepare('SELECT user_id, SUM(stack) AS total FROM poker_stacks GROUP BY user_id').all();
  for (const r of rows) credit(r.user_id, r.total);
  db.prepare('DELETE FROM poker_stacks').run();
}

export function createPokerTable(hub, { id, name, sb, bb }) {
  const minBuy = bb * 20;
  const maxBuy = bb * 200;
  const seats = Array(MAX_SEATS).fill(null);
  const t = { phase: 'waiting', board: [], button: -1, turn: -1, currentBet: 0, minRaise: bb, endsAt: null, result: null };
  let deck = [];
  let timer = null;

  const push = () => hub.broadcast(id);
  const betting = () => ['preflop', 'flop', 'turn', 'river'].includes(t.phase);
  const live = () => seats.filter((p) => p && p.inHand && !p.folded);
  const canAct = (p) => p.inHand && !p.folded && !p.allIn;
  const seatOf = (userId) => seats.findIndex((p) => p && p.id === userId && !p.left);
  const nextSeat = (from, pred) => {
    for (let i = 1; i <= MAX_SEATS; i++) {
      const idx = (from + i + MAX_SEATS) % MAX_SEATS;
      if (seats[idx] && pred(seats[idx])) return idx;
    }
    return -1;
  };
  const pay = (p, amount) => {
    const x = Math.min(p.stack, amount);
    p.stack -= x;
    p.bet += x;
    p.total += x;
    if (p.stack === 0) p.allIn = true;
  };

  function setTurn(idx) {
    t.turn = idx;
    clearTimeout(timer);
    t.endsAt = Date.now() + TURN_MS;
    timer = setTimeout(() => {
      const p = seats[idx];
      p.timeouts = (p.timeouts || 0) + 1;
      // Два пропуска подряд — игрок встаёт из-за стола.
      if (p.timeouts >= 2) return standUp(p.id);
      applyAction(idx, p.bet === t.currentBet ? 'check' : 'fold');
    }, TURN_MS);
    push();
  }

  function startHand() {
    clearTimeout(timer);
    for (let i = 0; i < MAX_SEATS; i++) {
      const p = seats[i];
      if (!p) continue;
      if (p.left) seats[i] = null;
      else if (p.stack === 0) {
        qDrop.run(p.id, id);
        seats[i] = null;
        hub.sendUser(p.id, { t: 'toast', message: 'Фишки на столе закончились — сделайте новый бай-ин' });
      }
    }
    const players = seats.filter(Boolean);
    Object.assign(t, { board: [], turn: -1, currentBet: 0, minRaise: bb, endsAt: null });
    for (const p of players) Object.assign(p, { cards: [], bet: 0, total: 0, folded: false, allIn: false, inHand: false, acted: false });
    if (players.length < 2) {
      t.phase = 'waiting';
      return push();
    }
    t.result = null;
    deck = newDeck();
    t.button = nextSeat(t.button, () => true);
    // В игре один на один малый блайнд ставит баттон.
    const sbSeat = players.length === 2 ? t.button : nextSeat(t.button, () => true);
    const bbSeat = nextSeat(sbSeat, () => true);
    for (const p of players) {
      p.inHand = true;
      p.cards = [deck.pop(), deck.pop()];
    }
    pay(seats[sbSeat], sb);
    pay(seats[bbSeat], bb);
    t.currentBet = bb;
    t.phase = 'preflop';
    proceed(bbSeat);
  }

  // Решает, что дальше: следующий игрок, следующая улица или конец раздачи.
  function proceed(from) {
    const alive = live();
    if (alive.length === 1) return finish();
    const actors = alive.filter((p) => !p.allIn);
    const roundDone = actors.every((p) => p.acted && p.bet === t.currentBet);
    const nobodyToBetAgainst = actors.length <= 1 && actors.every((p) => p.bet >= t.currentBet);
    if (roundDone || nobodyToBetAgainst) return nextStreet();
    setTurn(nextSeat(from, canAct));
  }

  function nextStreet() {
    clearTimeout(timer);
    for (const p of live()) { p.bet = 0; p.acted = false; }
    Object.assign(t, { currentBet: 0, minRaise: bb, turn: -1, endsAt: null });
    if (t.phase === 'river') return finish();
    if (t.phase === 'preflop') { t.board = [deck.pop(), deck.pop(), deck.pop()]; t.phase = 'flop'; }
    else { t.board.push(deck.pop()); t.phase = t.phase === 'flop' ? 'turn' : 'river'; }
    if (live().filter((p) => !p.allIn).length <= 1) {
      // Торговаться некому — просто открываем оставшиеся карты.
      push();
      timer = setTimeout(nextStreet, RUNOUT_MS);
      return;
    }
    setTurn(nextSeat(t.button, canAct));
  }

  function finish() {
    clearTimeout(timer);
    const alive = live();
    const all = seats.filter((p) => p && p.inHand);

    // Возврат неуравненной части ставки.
    const sorted = [...all].sort((a, b) => b.total - a.total);
    if (sorted.length > 1 && sorted[0].total > sorted[1].total) {
      const extra = sorted[0].total - sorted[1].total;
      sorted[0].total -= extra;
      sorted[0].stack += extra;
    }

    const won = new Map(all.map((p) => [p, 0]));
    const showdown = alive.length > 1;
    const scores = new Map();
    if (showdown) for (const p of alive) scores.set(p, evaluate([...p.cards, ...t.board]));

    // Основной и побочные банки: по уровням вложений игроков, оставшихся в раздаче.
    const levels = [...new Set(alive.map((p) => p.total))].sort((a, b) => a - b);
    let prev = 0;
    let carried = 0;
    levels.forEach((level, li) => {
      let amount = carried;
      carried = 0;
      for (const p of all) amount += Math.min(p.total, level) - Math.min(p.total, prev);
      // Вложения сбросивших карты сверх максимального уровня уходят в последний банк.
      if (li === levels.length - 1) for (const p of all) amount += Math.max(0, p.total - level);
      const eligible = alive.filter((p) => p.total >= level);
      prev = level;
      let winners = eligible;
      if (showdown) {
        const best = eligible.reduce((b, p) => (compareHands(scores.get(p), scores.get(b)) > 0 ? p : b));
        winners = eligible.filter((p) => compareHands(scores.get(p), scores.get(best)) === 0);
      }
      const share = Math.floor(amount / winners.length);
      winners.forEach((p, i) => won.set(p, won.get(p) + share + (i < amount % winners.length ? 1 : 0)));
    });

    for (const p of all) {
      const w = won.get(p);
      p.stack += w;
      if (p.total > 0 || w > 0)
        recordBet(p.id, 'poker', p.total, w, showdown && scores.has(p) ? HAND_NAMES[scores.get(p)[0]] : p.folded ? 'фолд' : 'без вскрытия');
      if (!p.left) qSave.run(p.id, id, p.stack);
    }

    t.result = {
      showdown,
      winners: all.filter((p) => won.get(p) > 0).map((p) => ({
        seat: seats.indexOf(p), id: p.id, name: p.name, amount: won.get(p),
        hand: showdown ? HAND_NAMES[scores.get(p)[0]] : null,
      })),
    };
    t.phase = 'showdown';
    t.turn = -1;
    t.endsAt = null;
    timer = setTimeout(startHand, showdown ? 6500 : 3000);
    push();
  }

  function applyAction(idx, kind, amount) {
    const p = seats[idx];
    const maxTo = p.bet + p.stack;
    if (kind === 'allin') { kind = maxTo > t.currentBet ? 'raise' : 'call'; amount = maxTo; }
    if (kind === 'fold') p.folded = true;
    else if (kind === 'check') {
      if (p.bet !== t.currentBet) throw new GameError('Чек невозможен — нужно уравнять ставку');
    } else if (kind === 'call') pay(p, t.currentBet - p.bet);
    else if (kind === 'raise') {
      if (!Number.isInteger(amount) || amount <= t.currentBet || amount > maxTo)
        throw new GameError('Недопустимый размер ставки');
      const minTo = t.currentBet + t.minRaise;
      if (amount < minTo && amount !== maxTo) throw new GameError(`Минимальная ставка — ${minTo}`);
      if (amount - t.currentBet >= t.minRaise) t.minRaise = amount - t.currentBet;
      t.currentBet = amount;
      pay(p, amount - p.bet);
      for (const o of live()) o.acted = false;
    } else throw new GameError('Неизвестное действие');
    p.acted = true;
    proceed(idx);
  }

  function sit(user, seat, buyIn) {
    if (seats.some((p) => p && p.id === user.id)) throw new GameError('Вы уже за этим столом');
    if (!Number.isInteger(seat) || seat < 0 || seat >= MAX_SEATS || seats[seat]) throw new GameError('Место занято');
    if (!Number.isInteger(buyIn) || buyIn < minBuy || buyIn > maxBuy)
      throw new GameError(`Бай-ин — от ${minBuy} до ${maxBuy}`);
    debit(user.id, buyIn);
    seats[seat] = { id: user.id, name: user.name, stack: buyIn, cards: [], bet: 0, total: 0, folded: false, allIn: false, inHand: false, acted: false, left: false };
    qSave.run(user.id, id, buyIn);
    if (t.phase === 'waiting') startHand();
    else push();
  }

  function standUp(userId) {
    const idx = seatOf(userId);
    if (idx === -1) return;
    const p = seats[idx];
    credit(p.id, p.stack);
    qDrop.run(p.id, id);
    p.stack = 0;
    p.left = true;
    if (betting() && p.inHand && !p.folded) {
      // Уходит посреди раздачи: карты сбрасываются, место освободится после раздачи.
      p.folded = true;
      p.acted = true;
      if (t.turn === idx || live().length === 1) return proceed(idx);
    } else if (!p.inHand || t.phase === 'waiting') {
      seats[idx] = null;
    }
    push();
  }

  return {
    id,
    summary: () => ({ id, name, sb, bb, minBuy, maxBuy, seated: seats.filter((p) => p && !p.left).length, seats: MAX_SEATS }),
    onLeave: (user) => standUp(user.id),
    view(userId) {
      const reveal = t.phase === 'showdown' && t.result?.showdown;
      return {
        id, name, sb, bb, minBuy, maxBuy,
        phase: t.phase,
        board: t.board,
        pot: seats.reduce((s, p) => s + (p && p.inHand ? p.total : 0), 0),
        button: t.button,
        turn: t.turn,
        currentBet: t.currentBet,
        minRaise: t.minRaise,
        endsAt: t.endsAt,
        now: Date.now(),
        result: t.result,
        mySeat: seatOf(userId),
        seats: seats.map((p) =>
          p && {
            id: p.id, name: p.name, stack: p.stack, bet: p.bet, folded: p.folded, allIn: p.allIn && p.inHand,
            inHand: p.inHand, left: p.left,
            cards: !p.inHand ? [] : p.id === userId || (reveal && !p.folded) ? p.cards : ['??', '??'],
          }
        ),
      };
    },
    onAction(user, msg) {
      if (msg.a === 'sit') return sit(user, msg.seat, msg.buyIn);
      if (msg.a === 'stand') return standUp(user.id);
      const idx = seatOf(user.id);
      if (idx === -1 || !betting() || t.turn !== idx) throw new GameError('Сейчас не ваш ход');
      seats[idx].timeouts = 0;
      applyAction(idx, msg.a, msg.amount);
    },
  };
}
