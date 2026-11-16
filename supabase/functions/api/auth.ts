import { AuthError } from "./common.ts";

// Аккаунты по логину и паролю. Пароль хранится как PBKDF2-SHA256, токен — подписанный HMAC.
const enc = new TextEncoder();
const ITERATIONS = 100_000;
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;

const toHex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf as ArrayBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
const b64u = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${await derive(password, salt, ITERATIONS)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [, iter, salt, hash] = stored.split("$");
  const got = await derive(password, fromHex(salt), Number(iter));
  let diff = got.length ^ hash.length;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i % hash.length);
  return diff === 0;
}

let keyPromise: Promise<CryptoKey> | null = null;
function hmacKey() {
  const secret = Deno.env.get("APP_JWT_SECRET");
  if (!secret || secret.length < 32) throw new Error("APP_JWT_SECRET не задан");
  return (keyPromise ??= crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  ));
}

export async function signToken(uid: string) {
  const body = b64u(JSON.stringify({ uid, exp: Date.now() + TOKEN_TTL }));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body));
  return `${body}.${toHex(sig)}`;
}

export async function verifyToken(token: string | null): Promise<string | null> {
  try {
    const [body, sig] = (token || "").split(".");
    if (!body || !sig) return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), fromHex(sig), enc.encode(body));
    if (!ok) return null;
    const { uid, exp } = JSON.parse(unb64u(body));
    return exp > Date.now() ? uid : null;
  } catch {
    return null;
  }
}

export function validName(name: unknown) {
  const s = String(name ?? "").trim().replace(/\s+/g, " ");
  if (s.length < 2 || s.length > 20) throw new AuthError("Имя — от 2 до 20 символов");
  return s;
}

export function validCredentials(username: unknown, password: unknown) {
  const u = String(username ?? "").trim();
  const p = String(password ?? "");
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(u)) throw new AuthError("Логин — 3–16 символов: латиница, цифры, подчёркивание");
  if (p.length < 6 || p.length > 72) throw new AuthError("Пароль — от 6 символов");
  return { username: u, password: p };
}
