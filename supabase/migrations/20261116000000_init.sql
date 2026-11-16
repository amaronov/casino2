-- Казино: игроки, история ставок и состояние игровых комнат.
-- Доступ к таблицам есть только у Edge Function (она подключается к базе напрямую).
-- Для ключей anon/authenticated включён RLS без политик, то есть доступ закрыт полностью.

create table public.players (
  id            uuid primary key default gen_random_uuid(),
  username      text not null,
  display_name  text not null,
  password_hash text not null,
  balance       bigint not null default 10000 check (balance >= 0),
  last_bonus_at timestamptz not null default 'epoch',
  created_at    timestamptz not null default now()
);
create unique index players_username_key on public.players (lower(username));

create table public.bets (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.players (id) on delete cascade,
  game       text not null,
  amount     bigint not null,
  payout     bigint not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);
create index bets_user_idx on public.bets (user_id, id desc);

-- Одна строка на комнату; всё состояние игры лежит в jsonb и меняется под блокировкой строки.
create table public.rooms (
  id         text primary key,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.players enable row level security;
alter table public.bets enable row level security;
alter table public.rooms enable row level security;
revoke all on public.players, public.bets, public.rooms from anon, authenticated;
