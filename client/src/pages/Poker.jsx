import { useEffect, useState } from 'react';
import { socket } from '../lib/socket.js';
import { useApp, useRoom, fmt, compact } from '../lib/store.jsx';
import { Amount, Avatar, Icon, PlayingCard, Sheet, TimerBar, Empty } from '../components/ui.jsx';
import { TableList } from './Blackjack.jsx';

const PHASE = { waiting: 'Ждём игроков', preflop: 'Префлоп', flop: 'Флоп', turn: 'Тёрн', river: 'Ривер', showdown: 'Вскрытие' };

function Seat({ s, idx, seat, canSit, onSit }) {
  if (!seat || seat.left) {
    return (
      <button className="seat free" disabled={!canSit} onClick={() => onSit(idx)}>
        <span className="plus">+</span>
        <span className="small">{canSit ? 'Сесть' : 'Свободно'}</span>
      </button>
    );
  }
  const turn = s.turn === idx;
  const winner = s.phase === 'showdown' && s.result?.winners.find((w) => w.seat === idx);
  const mine = s.mySeat === idx;
  return (
    <div className={`seat ${turn ? 'turn' : ''} ${seat.folded || !seat.inHand ? 'out' : ''} ${winner ? 'winner' : ''} ${mine ? 'mine' : ''}`}>
      {s.button === idx && s.phase !== 'waiting' && <span className="dealer-btn" title="Баттон">D</span>}
      <div className="seat-head">
        {seat.bot
          ? <span className="avatar bot-ava" style={{ width: 26, height: 26 }}><Icon name="bot" size={16} /></span>
          : <Avatar id={seat.id} name={seat.name} size={26} />}
        <div className="grow">
          <b>{mine ? 'Вы' : seat.bot ? seat.name.replace(/^Бот /, '') : seat.name}</b>
          <span className="stack">{compact(seat.stack)}</span>
        </div>
      </div>
      <div className="seat-cards">
        {seat.inHand && !seat.folded
          ? seat.cards.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
          : <span className="muted small">{seat.folded ? 'Фолд' : 'Ждёт'}</span>}
      </div>
      <div className="seat-foot">
        {winner ? <span className="tag win">+{compact(winner.amount)}</span>
          : seat.allIn ? <span className="tag allin">Олл-ин</span>
          : seat.bet > 0 ? <span className="tag bet">{compact(seat.bet)}</span> : <span className="tag ghost">&nbsp;</span>}
      </div>
      {turn && (seat.bot ? <span className="thinking" aria-label="Бот думает"><i /><i /><i /></span>
        : <TimerBar endsAt={s.endsAt} total={25000} />)}
    </div>
  );
}

// Включение игры с ботами. Боты садятся на свободные места со своим стеком
// и уходят, когда за столом не остаётся людей.
function BotControl({ s }) {
  const bots = s.seats.filter((p) => p?.bot && !p.left).length;
  const free = s.seats.filter((p) => !p).length;
  const on = bots > 0;
  const set = (count) => socket.act('bots', { count });
  return (
    <div className={`bots ${on ? 'on' : ''}`}>
      <span className="bots-ico"><Icon name="bot" /></span>
      <div className="grow">
        <b>Игра с ботами</b>
        <span className="muted small">
          {on ? `${bots} ${bots === 1 ? 'бот' : bots < 5 ? 'бота' : 'ботов'} за столом` : free ? 'Займут свободные места' : 'Свободных мест нет'}
        </span>
      </div>
      {on && (
        <div className="stepper" role="group" aria-label="Число ботов">
          <button onClick={() => set(bots - 1)} aria-label="Убрать бота">−</button>
          <b>{bots}</b>
          <button onClick={() => set(bots + 1)} disabled={!free} aria-label="Добавить бота">+</button>
        </div>
      )}
      <button role="switch" aria-checked={on} aria-label="Игра с ботами" className={`switch ${on ? 'on' : ''}`}
        disabled={!on && !free} onClick={() => set(on ? 0 : Math.min(2, free))}>
        <span />
      </button>
    </div>
  );
}

function Actions({ s, me }) {
  const [raising, setRaising] = useState(false);
  const toCall = Math.min(s.currentBet - me.bet, me.stack);
  const maxTo = me.bet + me.stack;
  const minTo = Math.min(maxTo, s.currentBet + s.minRaise);
  const canRaise = maxTo > s.currentBet;
  const [to, setTo] = useState(minTo);
  // Новый ход — панель рейза сбрасывается.
  useEffect(() => { setRaising(false); setTo(minTo); }, [s.currentBet, s.phase, minTo]);

  const clamp = (v) => Math.max(minTo, Math.min(maxTo, Math.round(v)));
  const potAfterCall = s.pot + toCall;
  const presets = [
    ['Мин', minTo],
    ['½ банка', clamp(s.currentBet + potAfterCall / 2)],
    ['Банк', clamp(s.currentBet + potAfterCall)],
    ['Олл-ин', maxTo],
  ];
  const value = clamp(to);

  if (raising) {
    return (
      <>
        <div className="raise-presets">
          {presets.map(([label, v]) => (
            <button key={label} className={value === v ? 'on' : ''} onClick={() => setTo(v)}>{label}</button>
          ))}
        </div>
        <input type="range" min={minTo} max={maxTo} step={s.sb} value={value} onChange={(e) => setTo(Number(e.target.value))} aria-label="Размер ставки" />
        <div className="actions two">
          <button className="btn lg" onClick={() => setRaising(false)}>Назад</button>
          <button className="btn primary lg" onClick={() => socket.act(value === maxTo ? 'allin' : 'raise', { amount: value })}>
            {value === maxTo ? 'Олл-ин' : s.currentBet ? 'Рейз до' : 'Ставка'} {fmt(value)}
          </button>
        </div>
      </>
    );
  }
  return (
    <div className="actions">
      <button className="btn lg danger" onClick={() => socket.act('fold')}>Фолд</button>
      {toCall > 0
        ? <button className="btn lg" onClick={() => socket.act('call')}>Колл {fmt(toCall)}</button>
        : <button className="btn lg" onClick={() => socket.act('check')}>Чек</button>}
      <button className="btn primary lg" disabled={!canRaise} onClick={() => setRaising(true)}>{s.currentBet ? 'Рейз' : 'Ставка'}</button>
    </div>
  );
}

function BuyIn({ s, seat, onClose }) {
  const { balance } = useApp();
  const max = Math.min(s.maxBuy, balance);
  const [amount, setAmount] = useState(Math.min(max, s.bb * 100));
  const enough = balance >= s.minBuy;
  return (
    <Sheet title="Бай-ин" onClose={onClose}>
      {enough ? (
        <>
          <p className="muted small">Фишки переносятся с баланса на стол и возвращаются, когда вы встаёте.</p>
          <div className="buyin-value"><Amount value={amount} size={22} /></div>
          <input type="range" min={s.minBuy} max={max} step={s.bb} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Размер бай-ина" />
          <div className="dock-row"><span className="muted small">мин. {fmt(s.minBuy)}</span><span className="muted small">макс. {fmt(max)}</span></div>
          <button className="btn primary lg" onClick={() => { socket.act('sit', { seat, buyIn: amount }); onClose(); }}>Сесть за стол</button>
        </>
      ) : (
        <p className="muted">Для этого стола нужно минимум {fmt(s.minBuy)} фишек. Выберите стол с блайндами пониже или заберите ежедневный бонус.</p>
      )}
    </Sheet>
  );
}

function Table({ id }) {
  const s = useRoom(id);
  const [sitAt, setSitAt] = useState(null);
  if (!s) return <div className="page"><Empty>Подключаемся к столу…</Empty></div>;

  const seated = s.mySeat >= 0;
  const me = seated ? s.seats[s.mySeat] : null;
  const myTurn = seated && s.turn === s.mySeat;
  const seatProps = (idx) => ({ s, idx, seat: s.seats[idx], canSit: !seated, onSit: setSitAt });
  const win = s.phase === 'showdown' && s.result?.winners;

  return (
    <div className="page game-page poker">
      <div className="felt">
        <div className="seats">{[0, 1, 2].map((i) => <Seat key={i} {...seatProps(i)} />)}</div>
        <div className="board">
          <div className="board-meta">
            <span className="muted small">{PHASE[s.phase]}</span>
            {s.pot > 0 && <span className="pot">Банк <Amount value={s.pot} /></span>}
          </div>
          <div className="cards">
            {[0, 1, 2, 3, 4].map((i) => <PlayingCard key={i} card={s.board[i]} size="md" />)}
          </div>
          <div className={`board-note ${win ? '' : 'idle'}`} aria-live="polite">
            {win ? win.map((w) => `${w.name} +${fmt(w.amount)}${w.hand ? ' · ' + w.hand : ''}`).join('  ·  ')
              : s.phase === 'waiting' ? 'Для начала раздачи нужны минимум двое' : ' '}
          </div>
        </div>
        <div className="seats">{[5, 4, 3].map((i) => <Seat key={i} {...seatProps(i)} />)}</div>
      </div>

      {seated && <BotControl s={s} />}

      <div className="dock sticky">
        {seated ? (
          <>
            <div className="my-hand">
              <div className="cards">
                {me.inHand ? me.cards.map((c, i) => <PlayingCard key={i} card={c} size="lg" dim={me.folded} />)
                  : <><PlayingCard size="lg" /><PlayingCard size="lg" /></>}
              </div>
              <div className="grow">
                <span className="muted small">Ваш стек</span>
                <b className="big"><Amount value={me.stack} /></b>
              </div>
              <button className="btn sm" onClick={() => socket.act('stand')}>Встать</button>
            </div>
            {myTurn ? <Actions s={s} me={me} />
              : <div className="dock-note">
                  {s.phase === 'waiting' ? 'Ждём второго игрока — или включите ботов'
                    : s.phase === 'showdown' ? 'Следующая раздача через пару секунд'
                    : !me.inHand ? 'Вы вступите в игру со следующей раздачи'
                    : me.folded ? 'Вы сбросили карты'
                    : s.turn >= 0 ? `${s.seats[s.turn]?.bot ? 'Думает' : 'Ходит'} ${s.seats[s.turn]?.name}` : 'Открываем карты…'}
                </div>}
          </>
        ) : (
          <div className="dock-note">Нажмите на свободное место, чтобы сесть за стол. Потом можно включить ботов.</div>
        )}
      </div>
      <p className="muted small center">Блайнды {fmt(s.sb)} / {fmt(s.bb)} · бай-ин {fmt(s.minBuy)}–{fmt(s.maxBuy)}</p>

      {sitAt != null && <BuyIn s={s} seat={sitAt} onClose={() => setSitAt(null)} />}
    </div>
  );
}

export default function Poker({ id }) {
  if (id) return <Table id={id} />;
  return (
    <TableList game="poker" render={(t) => (
      <>
        <div className="grow">
          <b>{t.name}</b>
          <span className="muted small">Блайнды {fmt(t.sb)} / {fmt(t.bb)} · бай-ин от {fmt(t.minBuy)}{t.bots ? ` · ботов: ${t.bots}` : ''}</span>
        </div>
        <span className="pill"><Icon name="users" size={14} />{t.seated}/{t.seats}</span>
      </>
    )} />
  );
}
