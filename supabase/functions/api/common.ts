// deno-lint-ignore-file no-explicit-any
export class GameError extends Error {}
export class AuthError extends Error {}

// Криптостойкое целое в диапазоне [0, max).
export function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

export function assertAmount(amount: any, min = 1, max = 1_000_000) {
  if (!Number.isInteger(amount) || amount < min) throw new GameError(`Минимальная ставка — ${min}`);
  if (amount > max) throw new GameError(`Максимальная ставка — ${max}`);
}

// Игрок считается «в комнате», если его клиент обращался к ней за последние 25 секунд.
export const PRESENCE_MS = 25_000;
export function members(s: any, now: number): { id: string; name: string }[] {
  return Object.entries(s.seen || {})
    .filter(([, v]: any) => v.at > now - PRESENCE_MS)
    .map(([id, v]: any) => ({ id, name: v.name }));
}

// Отложенное действие комнаты. Таймеров в памяти нет: срок хранится в состоянии
// и исполняется при следующем обращении любого клиента после наступления срока.
export function schedule(s: any, ctx: any, ms: number, kind: string, arg?: any) {
  s.timer = { at: ctx.now + ms, kind, arg };
  return s.timer.at;
}
