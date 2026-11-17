// deno-lint-ignore-file no-explicit-any
import { GameError, randomInt, schedule } from "../common.ts";
import { compareHands, evaluate, HAND_NAMES, newDeck } from "../cards.ts";
import { decide } from "./pokerBot.ts";

// Безлимитный техасский холдем, до 6 игроков за столом.
// Фишки садятся на стол из баланса (бай-ин) и возвращаются на баланс при выходе.
const MAX_SEATS = 6;
const TURN_MS = 25_000;
const RUNOUT_MS = 1_300;
const ABSENT_MS = 60_000; // столько клиент может молчать, прежде чем игрока поднимут из-за стола
const BOT_NAMES = ["Бот Борис", "Бот Вера", "Бот Глеб", "Бот Дина", "Бот Лев", "Бот Мира"];
const BOT_BUYIN_BB = 100;

// Боты — это места с флагом bot. Их фишки не связаны ни с каким балансом: бот получает
// стек при посадке, а при уходе его фишки просто исчезают. Ходят они по отложенному таймеру,
// как и всё остальное за столом, поэтому раздача с ботами идёт, пока кто-то из людей за столом.

export function makePoker(cfg: { id: string; name: string; sb: number; bb: number }) {
  const { id, name, sb, bb } = cfg;
  const minBuy = bb * 20;
  const maxBuy = bb * 200;

  // Все функции раздачи работают с состоянием s и контекстом запроса ctx.
  function engine(s: any, ctx: any) {
    const seats: any[] = s.seats;
    const t = s.t;
    const betting = () => ["preflop", "flop", "turn", "river"].includes(t.phase);
    const live = () => seats.filter((p) => p && p.inHand && !p.folded);
    const canAct = (p: any) => p.inHand && !p.folded && !p.allIn;
    const seatOf = (uid: string) => seats.findIndex((p) => p && p.id === uid && !p.left);
    const hasHumans = () => seats.some((p) => p && !p.bot && !p.left);
    const potTotal = () => seats.reduce((sum, p) => sum + (p && p.inHand ? p.total : 0), 0);
    const nextSeat = (from: number, pred: (p: any) => boolean) => {
      for (let i = 1; i <= MAX_SEATS; i++) {
        const idx = (from + i + MAX_SEATS) % MAX_SEATS;
        if (seats[idx] && pred(seats[idx])) return idx;
      }
      return -1;
    };
    const pay = (p: any, amount: number) => {
      const x = Math.min(p.stack, amount);
      p.stack -= x;
      p.bet += x;
      p.total += x;
      if (p.stack === 0) p.allIn = true;
    };

    function setTurn(idx: number) {
      t.turn = idx;
      if (seats[idx].bot) {
        // Бот «думает» 1–2 секунды, чтобы за его ходом можно было уследить.
        t.endsAt = null;
        schedule(s, ctx, 900 + randomInt(1300), "bot", idx);
      } else t.endsAt = schedule(s, ctx, TURN_MS, "turn", idx);
    }

    function botMove(idx: number) {
      const p = seats[idx];
      if (!p || !p.bot || t.turn !== idx || !betting()) return;
      const choice = decide({
        cards: p.cards, board: t.board, stack: p.stack, bet: p.bet,
        currentBet: t.currentBet, minRaise: t.minRaise, pot: potTotal(), bb,
      });
      try {
        applyAction(idx, choice.a, choice.amount);
      } catch {
        // Недопустимое решение не должно ломать раздачу: чек, если можно, иначе фолд.
        applyAction(idx, p.bet === t.currentBet ? "check" : "fold");
      }
    }

    function turnTimeout(idx: number) {
      const p = seats[idx];
      if (!p) return;
      p.timeouts = (p.timeouts || 0) + 1;
      // Два пропуска подряд — игрок встаёт из-за стола.
      if (p.timeouts >= 2) return standUp(p.id);
      applyAction(idx, p.bet === t.currentBet ? "check" : "fold");
    }

    function startHand() {
      s.timer = null;
      for (let i = 0; i < MAX_SEATS; i++) {
        const p = seats[i];
        if (p && (p.left || p.stack === 0)) seats[i] = null;
      }
      // Без людей ботам за столом делать нечего.
      if (!hasHumans()) for (let i = 0; i < MAX_SEATS; i++) if (seats[i]?.bot) seats[i] = null;
      const players = seats.filter(Boolean);
      Object.assign(t, { board: [], turn: -1, currentBet: 0, minRaise: bb, endsAt: null });
      for (const p of players) {
        Object.assign(p, { cards: [], bet: 0, total: 0, folded: false, allIn: false, inHand: false, acted: false });
      }
      if (players.length < 2) {
        t.phase = "waiting";
        return;
      }
      t.result = null;
      s.deck = newDeck();
      t.button = nextSeat(t.button, () => true);
      // В игре один на один малый блайнд ставит баттон.
      const sbSeat = players.length === 2 ? t.button : nextSeat(t.button, () => true);
      const bbSeat = nextSeat(sbSeat, () => true);
      for (const p of players) {
        p.inHand = true;
        p.cards = [s.deck.pop(), s.deck.pop()];
      }
      s.deck.length = 5; // дальше нужны только пять карт стола
      pay(seats[sbSeat], sb);
      pay(seats[bbSeat], bb);
      t.currentBet = bb;
      t.phase = "preflop";
      proceed(bbSeat);
    }

    // Решает, что дальше: следующий игрок, следующая улица или конец раздачи.
    function proceed(from: number) {
      const alive = live();
      if (alive.length === 1) return finish();
      const actors = alive.filter((p) => !p.allIn);
      const roundDone = actors.every((p) => p.acted && p.bet === t.currentBet);
      const nobodyToBetAgainst = actors.length <= 1 && actors.every((p) => p.bet >= t.currentBet);
      if (roundDone || nobodyToBetAgainst) return nextStreet();
      setTurn(nextSeat(from, canAct));
    }

    function nextStreet() {
      s.timer = null;
      for (const p of live()) { p.bet = 0; p.acted = false; }
      Object.assign(t, { currentBet: 0, minRaise: bb, turn: -1, endsAt: null });
      if (t.phase === "river") return finish();
      if (t.phase === "preflop") { t.board = [s.deck.pop(), s.deck.pop(), s.deck.pop()]; t.phase = "flop"; }
      else { t.board.push(s.deck.pop()); t.phase = t.phase === "flop" ? "turn" : "river"; }
      if (live().filter((p) => !p.allIn).length <= 1) {
        // Торговаться некому — просто открываем оставшиеся карты.
        schedule(s, ctx, RUNOUT_MS, "runout");
        return;
      }
      setTurn(nextSeat(t.button, canAct));
    }

    function finish() {
      s.timer = null;
      const alive = live();
      const all = seats.filter((p) => p && p.inHand);

      // Возврат неуравненной части ставки.
      const sorted = [...all].sort((a, b) => b.total - a.total);
      if (sorted.length > 1 && sorted[0].total > sorted[1].total) {
        const extra = sorted[0].total - sorted[1].total;
        sorted[0].total -= extra;
        sorted[0].stack += extra;
      }

      const won = new Map<any, number>(all.map((p) => [p, 0]));
      const showdown = alive.length > 1;
      const scores = new Map<any, number[]>();
      if (showdown) for (const p of alive) scores.set(p, evaluate([...p.cards, ...t.board]));

      // Основной и побочные банки: по уровням вложений игроков, оставшихся в раздаче.
      const levels = [...new Set(alive.map((p) => p.total))].sort((a, b) => a - b);
      let prev = 0;
      levels.forEach((level, li) => {
        let amount = 0;
        for (const p of all) amount += Math.min(p.total, level) - Math.min(p.total, prev);
        // Вложения сбросивших карты сверх максимального уровня уходят в последний банк.
        if (li === levels.length - 1) for (const p of all) amount += Math.max(0, p.total - level);
        const eligible = alive.filter((p) => p.total >= level);
        prev = level;
        let winners = eligible;
        if (showdown) {
          const best = eligible.reduce((b, p) => (compareHands(scores.get(p)!, scores.get(b)!) > 0 ? p : b));
          winners = eligible.filter((p) => compareHands(scores.get(p)!, scores.get(best)!) === 0);
        }
        const share = Math.floor(amount / winners.length);
        winners.forEach((p, i) => won.set(p, won.get(p)! + share + (i < amount % winners.length ? 1 : 0)));
      });

      for (const p of all) {
        const w = won.get(p)!;
        p.stack += w;
        if (!p.bot && (p.total > 0 || w > 0)) {
          ctx.fx.bet(p.id, "poker", p.total, w,
            showdown && scores.has(p) ? HAND_NAMES[scores.get(p)![0]] : p.folded ? "фолд" : "без вскрытия");
        }
      }

      t.result = {
        showdown,
        winners: all.filter((p) => won.get(p)! > 0).map((p) => ({
          seat: seats.indexOf(p), id: p.id, name: p.name, amount: won.get(p),
          hand: showdown ? HAND_NAMES[scores.get(p)![0]] : null,
        })),
      };
      t.phase = "showdown";
      t.turn = -1;
      t.endsAt = null;
      schedule(s, ctx, showdown ? 6500 : 3000, "start");
    }

    function applyAction(idx: number, kind: string, amount?: number) {
      const p = seats[idx];
      const maxTo = p.bet + p.stack;
      if (kind === "allin") { kind = maxTo > t.currentBet ? "raise" : "call"; amount = maxTo; }
      if (kind === "fold") p.folded = true;
      else if (kind === "check") {
        if (p.bet !== t.currentBet) throw new GameError("Чек невозможен — нужно уравнять ставку");
      } else if (kind === "call") pay(p, t.currentBet - p.bet);
      else if (kind === "raise") {
        if (!Number.isInteger(amount) || amount! <= t.currentBet || amount! > maxTo) {
          throw new GameError("Недопустимый размер ставки");
        }
        const minTo = t.currentBet + t.minRaise;
        if (amount! < minTo && amount !== maxTo) throw new GameError(`Минимальная ставка — ${minTo}`);
        if (amount! - t.currentBet >= t.minRaise) t.minRaise = amount! - t.currentBet;
        t.currentBet = amount;
        pay(p, amount! - p.bet);
        for (const o of live()) o.acted = false;
      } else throw new GameError("Неизвестное действие");
      p.acted = true;
      proceed(idx);
    }

    async function sit(seat: any, buyIn: any) {
      const user = ctx.user;
      if (seats.some((p) => p && p.id === user.id)) throw new GameError("Вы уже за этим столом");
      if (!Number.isInteger(seat) || seat < 0 || seat >= MAX_SEATS || seats[seat]) throw new GameError("Место занято");
      if (!Number.isInteger(buyIn) || buyIn < minBuy || buyIn > maxBuy) {
        throw new GameError(`Бай-ин — от ${minBuy} до ${maxBuy}`);
      }
      await ctx.fx.debit(user.id, buyIn);
      seats[seat] = {
        id: user.id, name: user.name, stack: buyIn, cards: [], bet: 0, total: 0,
        folded: false, allIn: false, inHand: false, acted: false, left: false,
      };
      if (t.phase === "waiting") startHand();
    }

    function standUp(uid: string) {
      const idx = seatOf(uid);
      if (idx === -1) return;
      const p = seats[idx];
      ctx.fx.credit(p.id, p.stack);
      p.stack = 0;
      p.left = true;
      if (betting() && p.inHand && !p.folded) {
        // Уходит посреди раздачи: карты сбрасываются, место освободится после раздачи.
        p.folded = true;
        p.acted = true;
        if (t.turn === idx || live().length === 1) proceed(idx);
      } else if (!p.inHand || t.phase === "waiting") {
        seats[idx] = null;
      }
    }

    function removeBot(idx: number) {
      const p = seats[idx];
      if (!p?.bot || p.left) return;
      p.left = true;
      p.stack = 0;
      if (betting() && p.inHand && !p.folded) {
        // Бот уходит посреди раздачи: сбрасывает карты, место освободится после раздачи.
        p.folded = true;
        p.acted = true;
        if (t.turn === idx || live().length === 1) proceed(idx);
      } else if (!p.inHand || t.phase === "waiting") {
        seats[idx] = null;
      }
    }

    // Устанавливает число ботов за столом: добавляет на свободные места или убирает лишних.
    function setBots(count: any) {
      if (seatOf(ctx.user.id) === -1) throw new GameError("Сядьте за стол, чтобы управлять ботами");
      if (!Number.isInteger(count) || count < 0 || count >= MAX_SEATS) throw new GameError("Недопустимое число ботов");
      const active = () => seats.map((p, i) => ({ p, i })).filter(({ p }) => p?.bot && !p.left);
      for (let bots = active(); bots.length > count; bots = active()) {
        // Первыми уходят боты, которые сейчас не участвуют в раздаче.
        const pick = bots.find(({ p }) => !p.inHand || p.folded) ?? bots[bots.length - 1];
        removeBot(pick.i);
      }
      const used = new Set(seats.filter(Boolean).map((p) => p.name));
      let added = active().length;
      for (let i = 0; i < MAX_SEATS && added < count; i++) {
        if (seats[i]) continue;
        const name = BOT_NAMES.find((n) => !used.has(n)) ?? "Бот";
        used.add(name);
        seats[i] = {
          id: "bot:" + crypto.randomUUID().slice(0, 8), name, bot: true, stack: bb * BOT_BUYIN_BB,
          cards: [], bet: 0, total: 0, folded: false, allIn: false, inHand: false, acted: false, left: false,
        };
        added++;
      }
      if (t.phase === "waiting") startHand();
    }

    return {
      betting, seatOf, hasHumans, startHand, nextStreet, turnTimeout, applyAction, sit, standUp,
      botMove, removeBot, setBots,
    };
  }

  return {
    init: () => ({
      seats: Array(MAX_SEATS).fill(null),
      deck: [],
      t: { phase: "waiting", board: [], button: -1, turn: -1, currentBet: 0, minRaise: bb, endsAt: null, result: null },
    }),
    timers: {
      turn: (s: any, ctx: any, idx: number) => engine(s, ctx).turnTimeout(idx),
      runout: (s: any, ctx: any) => engine(s, ctx).nextStreet(),
      start: (s: any, ctx: any) => engine(s, ctx).startHand(),
      bot: (s: any, ctx: any, idx: number) => engine(s, ctx).botMove(idx),
    } as Record<string, any>,
    // Игроки, чей клиент давно молчит (закрыл вкладку, пропала сеть), встают из-за стола.
    post(s: any, ctx: any) {
      const e = engine(s, ctx);
      for (const p of s.seats) {
        if (p && !p.bot && !p.left && (s.seen[p.id]?.at ?? 0) < ctx.now - ABSENT_MS) e.standUp(p.id);
      }
      // Последний человек ушёл — боты встают вслед за ним.
      if (!e.hasHumans()) s.seats.forEach((p: any, i: number) => p?.bot && e.removeBot(i));
    },
    leave: (s: any, ctx: any) => engine(s, ctx).standUp(ctx.user.id),
    stacks: (s: any) => s.seats.filter((p: any) => p && !p.bot).map((p: any) => ({ id: p.id, stack: p.stack })),
    summary: (s: any) => ({
      id, name, sb, bb, minBuy, maxBuy,
      seated: s.seats.filter((p: any) => p && !p.left).length, seats: MAX_SEATS,
      bots: s.seats.filter((p: any) => p?.bot && !p.left).length,
    }),
    view(s: any, uid: string) {
      const t = s.t;
      const reveal = t.phase === "showdown" && t.result?.showdown;
      return {
        id, name, sb, bb, minBuy, maxBuy,
        phase: t.phase,
        board: t.board,
        pot: s.seats.reduce((sum: number, p: any) => sum + (p && p.inHand ? p.total : 0), 0),
        button: t.button,
        turn: t.turn,
        currentBet: t.currentBet,
        minRaise: t.minRaise,
        endsAt: t.endsAt,
        result: t.result,
        mySeat: s.seats.findIndex((p: any) => p && p.id === uid && !p.left),
        seats: s.seats.map((p: any) =>
          p && {
            id: p.id, name: p.name, stack: p.stack, bet: p.bet, folded: p.folded, allIn: p.allIn && p.inHand,
            inHand: p.inHand, left: p.left, bot: !!p.bot,
            cards: !p.inHand ? [] : p.id === uid || (reveal && !p.folded) ? p.cards : ["??", "??"],
          }
        ),
      };
    },
    async act(s: any, ctx: any, msg: any) {
      const e = engine(s, ctx);
      if (msg.a === "sit") return await e.sit(msg.seat, msg.buyIn);
      if (msg.a === "stand") return e.standUp(ctx.user.id);
      if (msg.a === "bots") return e.setBots(msg.count);
      const idx = e.seatOf(ctx.user.id);
      if (idx === -1 || !e.betting() || s.t.turn !== idx) throw new GameError("Сейчас не ваш ход");
      s.seats[idx].timeouts = 0;
      e.applyAction(idx, msg.a, msg.amount);
    },
  };
}
