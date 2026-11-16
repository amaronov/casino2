// deno-lint-ignore-file no-explicit-any
import { GameError, assertAmount, members, schedule } from "../common.ts";
import { bjValue, newDeck } from "../cards.ts";

// Блекджек с общим столом: до 5 игроков против дилера в одном раунде.
// Правила: 6 колод, дилер останавливается на 17, блекджек 3:2, удвоение на первых двух картах.
const BET_MS = 12_000;
const TURN_MS = 20_000;
const RESULT_MS = 5_000;
const DEAL_STEP_MS = 800;
const MAX_PLAYERS = 5;

export function makeBlackjack(cfg: { id: string; name: string; min: number; max: number }) {
  const { id, name, min, max } = cfg;

  function deal(s: any, ctx: any) {
    s.deck = newDeck(6).slice(0, 80); // на раунд с пятью игроками хватает с большим запасом
    s.dealer = [s.deck.pop(), s.deck.pop()];
    for (const p of s.players) {
      p.cards = [s.deck.pop(), s.deck.pop()];
      p.status = bjValue(p.cards) === 21 ? "blackjack" : "playing";
    }
    s.phase = "playing";
    s.turn = -1;
    nextTurn(s, ctx);
  }

  function nextTurn(s: any, ctx: any) {
    const i = s.players.findIndex((p: any, idx: number) => idx > s.turn && p.status === "playing");
    if (i === -1) return dealerPlay(s, ctx);
    s.turn = i;
    s.endsAt = schedule(s, ctx, TURN_MS, "turn");
  }

  function dealerPlay(s: any, ctx: any) {
    s.phase = "dealer";
    s.turn = -1;
    s.endsAt = null;
    schedule(s, ctx, DEAL_STEP_MS, "dealer");
  }

  function settle(s: any, ctx: any) {
    const dv = bjValue(s.dealer);
    const dealerBJ = dv === 21 && s.dealer.length === 2;
    for (const p of s.players) {
      const v = bjValue(p.cards);
      let mult = 0;
      if (p.status === "bust") mult = 0;
      else if (p.status === "blackjack") mult = dealerBJ ? 1 : 2.5;
      else if (dealerBJ) mult = 0;
      else if (dv > 21 || v > dv) mult = 2;
      else if (v === dv) mult = 1;
      p.payout = Math.floor(p.bet * mult);
      p.outcome = mult === 0 ? "lose" : mult === 1 ? "push" : p.status === "blackjack" ? "blackjack" : "win";
      ctx.fx.credit(p.id, p.payout);
      ctx.fx.bet(p.id, "blackjack", p.bet, p.payout, `${v} против ${dv}`);
    }
    s.phase = "result";
    s.endsAt = schedule(s, ctx, RESULT_MS, "reset");
  }

  return {
    init: () => ({ phase: "betting", endsAt: null, turn: -1, dealer: [], players: [], deck: [] }),
    timers: {
      deal,
      // Время на ход вышло — игрок автоматически останавливается.
      turn(s: any, ctx: any) {
        if (s.players[s.turn]) s.players[s.turn].status = "stand";
        nextTurn(s, ctx);
      },
      dealer(s: any, ctx: any) {
        const anyoneLeft = s.players.some((p: any) => p.status === "stand" || p.status === "blackjack");
        if (anyoneLeft && bjValue(s.dealer) < 17) {
          s.dealer.push(s.deck.pop());
          schedule(s, ctx, DEAL_STEP_MS, "dealer");
        } else settle(s, ctx);
      },
      reset(s: any) {
        Object.assign(s, { phase: "betting", endsAt: null, turn: -1, dealer: [], players: [], deck: [], timer: null });
      },
    } as Record<string, any>,
    summary: (s: any, now: number) => ({
      id, name, min, max, players: s.players.length, online: members(s, now).length, seats: MAX_PLAYERS,
    }),
    view(s: any, uid: string, now: number) {
      const hideHole = s.phase === "playing";
      return {
        id, name, min, max,
        phase: s.phase,
        endsAt: s.endsAt,
        turn: s.turn,
        online: members(s, now).length,
        maxPlayers: MAX_PLAYERS,
        dealer: hideHole && s.dealer.length ? [s.dealer[0], "??"] : s.dealer,
        dealerValue: hideHole ? bjValue(s.dealer.slice(0, 1)) : bjValue(s.dealer),
        players: s.players.map((p: any) => ({
          id: p.id, name: p.name, bet: p.bet, cards: p.cards, value: bjValue(p.cards),
          status: p.status, outcome: p.outcome ?? null, payout: p.payout ?? null,
        })),
        me: s.players.findIndex((p: any) => p.id === uid),
      };
    },
    async act(s: any, ctx: any, msg: any) {
      const user = ctx.user;
      if (msg.a === "bet") {
        if (s.phase !== "betting") throw new GameError("Раунд уже идёт — дождитесь следующего");
        if (s.players.some((p: any) => p.id === user.id)) throw new GameError("Ставка уже сделана");
        if (s.players.length >= MAX_PLAYERS) throw new GameError("За столом нет мест");
        assertAmount(msg.amount, min, max);
        await ctx.fx.debit(user.id, msg.amount);
        s.players.push({ id: user.id, name: user.name, bet: msg.amount, cards: [], status: "waiting" });
        // Отсчёт до раздачи запускает первая ставка.
        if (s.players.length === 1) s.endsAt = schedule(s, ctx, BET_MS, "deal");
        return;
      }
      if (msg.a === "deal") {
        // Тот, кто поставил, может не ждать таймер, если он за столом один.
        if (s.phase === "betting" && s.players.length === 1 && s.players[0].id === user.id &&
            members(s, ctx.now).length === 1) deal(s, ctx);
        return;
      }
      const p = s.players[s.turn];
      if (s.phase !== "playing" || !p || p.id !== user.id) throw new GameError("Сейчас не ваш ход");
      if (msg.a === "stand") p.status = "stand";
      else if (msg.a === "hit" || msg.a === "double") {
        if (msg.a === "double") {
          if (p.cards.length !== 2) throw new GameError("Удвоить можно только на первых двух картах");
          await ctx.fx.debit(user.id, p.bet);
          p.bet *= 2;
        }
        p.cards.push(s.deck.pop());
        const v = bjValue(p.cards);
        if (v > 21) p.status = "bust";
        else if (v === 21 || msg.a === "double") p.status = "stand";
        else {
          // Игрок продолжает ход — его таймер запускается заново.
          s.endsAt = schedule(s, ctx, TURN_MS, "turn");
          return;
        }
      } else return;
      nextTurn(s, ctx);
    },
  };
}
