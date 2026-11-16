import { GameError, assertAmount, debit, credit, recordBet } from '../wallet.js';
import { newDeck, bjValue } from './cards.js';

// Блекджек с общим столом: до 5 игроков против дилера в одном раунде.
// Правила: 6 колод, дилер останавливается на 17, блекджек 3:2, удвоение на первых двух картах.
const BET_MS = 12_000;
const TURN_MS = 20_000;
const RESULT_MS = 5_000;
const DEAL_STEP_MS = 800;
const MAX_PLAYERS = 5;

export function createBlackjackTable(hub, { id, name, min, max }) {
  const s = { phase: 'betting', endsAt: null, turn: -1, dealer: [], players: [] };
  let deck = [];
  let timer = null;

  const schedule = (ms, fn, visible = true) => {
    clearTimeout(timer);
    s.endsAt = visible ? Date.now() + ms : null;
    timer = setTimeout(fn, ms);
  };
  const push = () => hub.broadcast(id);

  function deal() {
    deck = newDeck(6);
    s.dealer = [deck.pop(), deck.pop()];
    for (const p of s.players) {
      p.cards = [deck.pop(), deck.pop()];
      p.status = bjValue(p.cards) === 21 ? 'blackjack' : 'playing';
    }
    s.phase = 'playing';
    s.turn = -1;
    nextTurn();
  }

  function nextTurn() {
    const i = s.players.findIndex((p, idx) => idx > s.turn && p.status === 'playing');
    if (i === -1) return dealerPlay();
    s.turn = i;
    schedule(TURN_MS, () => {
      s.players[i].status = 'stand';
      nextTurn();
    });
    push();
  }

  function dealerPlay() {
    s.phase = 'dealer';
    s.turn = -1;
    const anyoneLeft = s.players.some((p) => p.status === 'stand' || p.status === 'blackjack');
    const step = () => {
      if (anyoneLeft && bjValue(s.dealer) < 17) {
        s.dealer.push(deck.pop());
        push();
        schedule(DEAL_STEP_MS, step, false);
      } else settle();
    };
    push();
    schedule(DEAL_STEP_MS, step, false);
  }

  function settle() {
    const dv = bjValue(s.dealer);
    const dealerBJ = dv === 21 && s.dealer.length === 2;
    for (const p of s.players) {
      const v = bjValue(p.cards);
      let mult = 0;
      if (p.status === 'bust') mult = 0;
      else if (p.status === 'blackjack') mult = dealerBJ ? 1 : 2.5;
      else if (dealerBJ) mult = 0;
      else if (dv > 21 || v > dv) mult = 2;
      else if (v === dv) mult = 1;
      p.payout = Math.floor(p.bet * mult);
      p.outcome = mult === 0 ? 'lose' : mult === 1 ? 'push' : p.status === 'blackjack' ? 'blackjack' : 'win';
      credit(p.id, p.payout);
      recordBet(p.id, 'blackjack', p.bet, p.payout, `${v} против ${dv}`);
    }
    s.phase = 'result';
    schedule(RESULT_MS, reset);
    push();
  }

  function reset() {
    clearTimeout(timer);
    s.phase = 'betting';
    s.endsAt = null;
    s.turn = -1;
    s.dealer = [];
    s.players = [];
    push();
  }

  function act(user, kind) {
    const p = s.players[s.turn];
    if (s.phase !== 'playing' || !p || p.id !== user.id) throw new GameError('Сейчас не ваш ход');
    if (kind === 'stand') p.status = 'stand';
    else if (kind === 'hit' || kind === 'double') {
      if (kind === 'double') {
        if (p.cards.length !== 2) throw new GameError('Удвоить можно только на первых двух картах');
        debit(user.id, p.bet);
        p.bet *= 2;
        p.doubled = true;
      }
      p.cards.push(deck.pop());
      const v = bjValue(p.cards);
      if (v > 21) p.status = 'bust';
      else if (v === 21 || kind === 'double') p.status = 'stand';
      else {
        // Игрок продолжает ход — перезапускаем его таймер.
        const i = s.turn;
        schedule(TURN_MS, () => {
          s.players[i].status = 'stand';
          nextTurn();
        });
        return push();
      }
    } else return;
    nextTurn();
  }

  return {
    id,
    summary: () => ({ id, name, min, max, players: s.players.length, online: hub.members(id).length, seats: MAX_PLAYERS }),
    view(userId) {
      const hideHole = s.phase === 'playing';
      return {
        id, name, min, max,
        phase: s.phase,
        endsAt: s.endsAt,
        now: Date.now(),
        turn: s.turn,
        online: hub.members(id).length,
        maxPlayers: MAX_PLAYERS,
        dealer: hideHole && s.dealer.length ? [s.dealer[0], '??'] : s.dealer,
        dealerValue: hideHole ? bjValue(s.dealer.slice(0, 1)) : bjValue(s.dealer),
        players: s.players.map((p) => ({
          id: p.id, name: p.name, bet: p.bet, cards: p.cards, value: bjValue(p.cards),
          status: p.status, outcome: p.outcome ?? null, payout: p.payout ?? null,
        })),
        me: s.players.findIndex((p) => p.id === userId),
      };
    },
    onAction(user, msg) {
      if (msg.a === 'bet') {
        if (s.phase !== 'betting') throw new GameError('Раунд уже идёт — дождитесь следующего');
        if (s.players.some((p) => p.id === user.id)) throw new GameError('Ставка уже сделана');
        if (s.players.length >= MAX_PLAYERS) throw new GameError('За столом нет мест');
        assertAmount(msg.amount, min, max);
        debit(user.id, msg.amount);
        s.players.push({ id: user.id, name: user.name, bet: msg.amount, cards: [], status: 'waiting' });
        // Отсчёт до раздачи запускает первая ставка.
        if (s.players.length === 1) schedule(BET_MS, deal);
        push();
      } else if (msg.a === 'deal') {
        // Тот, кто поставил, может не ждать таймер, если он за столом один.
        if (s.phase === 'betting' && s.players.length === 1 && s.players[0].id === user.id &&
            hub.members(id).length === 1) deal();
      } else act(user, msg.a);
    },
  };
}
