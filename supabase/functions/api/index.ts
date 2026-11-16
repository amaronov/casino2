// deno-lint-ignore-file no-explicit-any
// Единая точка входа API казино. Клиент шлёт POST { op, ... } и получает JSON.
// Вся игровая логика исполняется здесь, внутри транзакции с блокировкой строки комнаты.
import postgres from "npm:postgres@3.4.5";
import { AuthError, GameError, members } from "./common.ts";
import { hashPassword, signToken, validCredentials, validName, verifyPassword, verifyToken } from "./auth.ts";
import { slots, SYMBOLS, LINES } from "./games/slots.ts";
import { roulette } from "./games/roulette.ts";
import { makeBlackjack } from "./games/blackjack.ts";
import { makePoker } from "./games/poker.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 4, idle_timeout: 20 });

const DAILY_BONUS = 2_500;
const BJ = [
  { id: "bj:1", name: "Новичок", min: 10, max: 1_000 },
  { id: "bj:2", name: "Классика", min: 100, max: 10_000 },
  { id: "bj:3", name: "Хайроллер", min: 500, max: 50_000 },
];
const POKER = [
  { id: "poker:1", name: "Микро", sb: 5, bb: 10 },
  { id: "poker:2", name: "Средний", sb: 25, bb: 50 },
  { id: "poker:3", name: "Высокий", sb: 100, bb: 200 },
];
const GAMES: Record<string, any> = { slots, roulette };
for (const c of BJ) GAMES[c.id] = makeBlackjack(c);
for (const c of POKER) GAMES[c.id] = makePoker(c);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-casino-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const PLAYER = sql`id, username, display_name, balance::float8 as balance,
  (extract(epoch from created_at) * 1000)::float8 as created_at, (extract(epoch from last_bonus_at) * 1000)::float8 as last_bonus_at`;
const publicUser = (u: any) => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  balance: u.balance,
  createdAt: Math.round(u.created_at),
  nextBonusAt: Math.round(u.last_bonus_at) + 24 * 60 * 60 * 1000,
});

// Операции с балансом внутри транзакции. Списание выполняется сразу (может не пройти),
// начисления и записи в историю копятся и применяются в конце.
function makeFx(tx: any) {
  const credits = new Map<string, number>();
  const bets: any[] = [];
  return {
    async debit(uid: string, amount: number) {
      const r = await tx`update players set balance = balance - ${amount}
                         where id = ${uid} and balance >= ${amount} returning id`;
      if (!r.length) throw new GameError("Недостаточно фишек");
    },
    credit(uid: string, amount: number) {
      if (amount > 0) credits.set(uid, (credits.get(uid) || 0) + amount);
    },
    bet(uid: string, game: string, amount: number, payout: number, detail: string) {
      bets.push({ user_id: uid, game, amount, payout, detail });
    },
    async flush() {
      for (const [uid, amount] of credits) await tx`update players set balance = balance + ${amount} where id = ${uid}`;
      if (bets.length) await tx`insert into bets ${tx(bets, "user_id", "game", "amount", "payout", "detail")}`;
    },
  };
}

// Исполняет наступившие отложенные действия комнаты (ходы по таймеру, смену фаз).
function runTimers(game: any, s: any, ctx: any) {
  for (let i = 0; i < 500 && s.timer && s.timer.at <= ctx.realNow; i++) {
    const t = s.timer;
    s.timer = null;
    ctx.now = t.at;
    game.timers[t.kind]?.(s, ctx, t.arg);
  }
  ctx.now = ctx.realNow;
}

const fingerprint = (s: any, now: number) => JSON.stringify({ ...s, seen: members(s, now).length });

// Общий сценарий для любого обращения к комнате: блокировка, таймеры, действие, сохранение.
async function inRoom(roomId: string, uid: string, mode: "view" | "leave" | "act", msg?: any) {
  const game = GAMES[roomId];
  if (!game) throw new GameError("Комната не найдена");
  return await sql.begin(async (tx: any) => {
    await tx`insert into rooms (id, state) values (${roomId}, ${tx.json(game.init())}) on conflict do nothing`;
    const [row] = await tx`select state from rooms where id = ${roomId} for update`;
    const [player] = await tx`select id, display_name from players where id = ${uid}`;
    if (!player) throw new AuthError("Требуется вход");

    const s = row.state;
    s.seen ??= {};
    s.v ??= 0;
    const realNow = Date.now();
    const before = fingerprint(s, realNow);
    const fx = makeFx(tx);
    const ctx: any = { now: realNow, realNow, user: { id: player.id, name: player.display_name }, fx, reply: null };

    if (mode === "leave") delete s.seen[uid];
    else s.seen[uid] = { name: player.display_name, at: realNow };
    for (const k of Object.keys(s.seen)) if (s.seen[k].at < realNow - 300_000) delete s.seen[k];

    game.pre?.(s, ctx);
    runTimers(game, s, ctx);
    if (mode === "leave") game.leave?.(s, ctx);
    if (mode === "act") await game.act(s, ctx, msg);
    game.post?.(s, ctx);
    await fx.flush();

    const changed = fingerprint(s, realNow) !== before;
    if (changed) s.v++;
    await tx`update rooms set state = ${tx.json(s)}, updated_at = now() where id = ${roomId}`;
    // Остальным клиентам уходит только сигнал «состояние изменилось»; своё представление
    // (со своими картами и ставками) каждый запрашивает сам.
    if (changed) await tx`select realtime.send(${tx.json({ v: s.v })}, 'changed', ${"room-" + roomId.replace(":", "-")}, false)`;

    const [{ balance }] = await tx`select balance::float8 as balance from players where id = ${uid}`;
    return {
      state: { ...game.view(s, uid, realNow), v: s.v, now: realNow, nextAt: s.timer?.at ?? null },
      balance,
      reply: ctx.reply,
    };
  });
}

const BOARDS: Record<string, any> = {
  win: sql`select p.id, p.display_name as name, max(b.payout - b.amount)::float8 as value
           from bets b join players p on p.id = b.user_id group by p.id having max(b.payout - b.amount) > 0`,
  profit: sql`select p.id, p.display_name as name, sum(b.payout - b.amount)::float8 as value
              from bets b join players p on p.id = b.user_id group by p.id`,
  balance: sql`select id, display_name as name, balance::float8 as value from players`,
};

async function handle(op: string, body: any, token: string | null) {
  if (op === "register") {
    const { username, password } = validCredentials(body.username, body.password);
    const name = validName(body.displayName || username);
    const hash = await hashPassword(password);
    const rows = await sql`insert into players (username, display_name, password_hash)
                           values (${username}, ${name}, ${hash})
                           on conflict (lower(username)) do nothing returning ${PLAYER}`;
    if (!rows.length) throw new AuthError("Этот логин уже занят");
    return { token: await signToken(rows[0].id), user: publicUser(rows[0]) };
  }
  if (op === "login") {
    const username = String(body.username ?? "").trim();
    const [u] = await sql`select ${PLAYER}, password_hash from players where lower(username) = lower(${username})`;
    if (!u || !(await verifyPassword(String(body.password ?? ""), u.password_hash))) {
      throw new AuthError("Неверный логин или пароль");
    }
    return { token: await signToken(u.id), user: publicUser(u) };
  }
  if (op === "paytable") return { symbols: SYMBOLS.map(({ id, pays }) => ({ id, pays })), lines: LINES };

  const uid = await verifyToken(token);
  if (!uid) return json({ error: "Требуется вход" }, 401);

  switch (op) {
    case "me": {
      const [u] = await sql`select ${PLAYER} from players where id = ${uid}`;
      if (!u) return json({ error: "Требуется вход" }, 401);
      return { user: publicUser(u) };
    }
    case "rename": {
      const name = validName(body.displayName);
      const [u] = await sql`update players set display_name = ${name} where id = ${uid} returning ${PLAYER}`;
      return { user: publicUser(u) };
    }
    case "bonus": {
      // Условие в самом запросе не даёт получить бонус дважды.
      const [u] = await sql`update players set balance = balance + ${DAILY_BONUS}, last_bonus_at = now()
                            where id = ${uid} and last_bonus_at <= now() - interval '24 hours' returning ${PLAYER}`;
      if (!u) throw new GameError("Бонус пока недоступен");
      return { user: publicUser(u), bonus: DAILY_BONUS };
    }
    case "history": {
      const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 50);
      const offset = Math.max(Number(body.offset) || 0, 0);
      const items = await sql`select id::float8 as id, game, amount::float8 as amount, payout::float8 as payout, detail,
                                     (extract(epoch from created_at) * 1000)::float8 as "createdAt"
                              from bets where user_id = ${uid} order by id desc limit ${limit} offset ${offset}`;
      const [stats] = await sql`select count(*)::int as count, coalesce(sum(amount), 0)::float8 as wagered,
                                       coalesce(sum(payout), 0)::float8 as won,
                                       greatest(coalesce(max(payout - amount), 0), 0)::float8 as "biggestWin"
                                from bets where user_id = ${uid}`;
      return { items, stats };
    }
    case "leaderboard": {
      const by = body.by in BOARDS ? body.by : "balance";
      const rows: any[] = [...(await sql`${BOARDS[by]}`)];
      if (by === "balance") {
        // Фишки на покерных столах тоже считаются частью баланса.
        const tables = await sql`select id, state from rooms where id like 'poker:%'`;
        const onTable = new Map<string, number>();
        for (const r of tables) for (const p of GAMES[r.id]?.stacks(r.state) ?? []) onTable.set(p.id, (onTable.get(p.id) || 0) + p.stack);
        for (const r of rows) r.value += onTable.get(r.id) || 0;
      }
      rows.sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1));
      rows.forEach((r, i) => (r.rank = i + 1));
      return { top: rows.slice(0, 50), me: rows.find((r) => r.id === uid) || null };
    }
    case "lobby": {
      const now = Date.now();
      const rows = await sql`select id, state from rooms`;
      const state = new Map<string, any>(rows.map((r: any) => [r.id, r.state]));
      const sum = (id: string) => GAMES[id].summary(state.get(id) ?? { ...GAMES[id].init(), seen: {} }, now);
      return { slots: sum("slots"), roulette: sum("roulette"), blackjack: BJ.map((c) => sum(c.id)), poker: POKER.map((c) => sum(c.id)) };
    }
    case "room":
      return await inRoom(String(body.room), uid, "view");
    case "leave":
      return await inRoom(String(body.room), uid, "leave");
    case "act":
      return await inRoom(String(body.room), uid, "act", body);
    default:
      return json({ error: "Неизвестная операция" }, 404);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Только POST" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const token = (req.headers.get("x-casino-token") || "").trim() || null;
    const result = await handle(String(body.op ?? ""), body, token);
    return result instanceof Response ? result : json(result);
  } catch (e) {
    if (e instanceof GameError || e instanceof AuthError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "Внутренняя ошибка сервера" }, 500);
  }
});
