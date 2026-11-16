import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';
import { useApp, useRoom, go, fmt } from '../lib/store.jsx';
import { Amount, Avatar, BetPicker, Icon, PlayingCard, Seconds, TimerBar, Empty } from '../components/ui.jsx';

export function TableList({ game, render }) {
  const [tables, setTables] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api('lobby').then((r) => alive && setTables(r[game])).catch(() => {});
    load();
    const t = setInterval(() => document.hidden || load(), 10_000);
    return () => { alive = false; clearInterval(t); };
  }, [game]);
  return (
    <div className="page">
      <h2 className="section-title">Выберите стол</h2>
      <div className="list">
        {tables ? tables.map((t) => (
          <button key={t.id} className="row tall" onClick={() => go(game + '/' + t.id)}>{render(t)}</button>
        )) : <Empty>Загружаем столы…</Empty>}
      </div>
    </div>
  );
}

const OUTCOME = { win: 'Победа', lose: 'Проигрыш', push: 'Ничья', blackjack: 'Блекджек!' };
const STATUS = { bust: 'Перебор', stand: 'Хватит', blackjack: 'Блекджек', waiting: 'Ждёт раздачи' };

function Hand({ p, active, mine, phase }) {
  return (
    <div className={`bj-hand ${active ? 'active' : ''} ${mine ? 'mine' : ''} ${p.outcome || ''}`}>
      <div className="bj-who">
        <Avatar id={p.id} name={p.name} size={24} />
        <b>{mine ? 'Вы' : p.name}</b>
        <Amount value={p.bet} />
      </div>
      <div className="cards">
        {p.cards.length ? p.cards.map((c, i) => <PlayingCard key={i} card={c} size={mine ? 'lg' : 'md'} />)
          : <><PlayingCard size={mine ? 'lg' : 'md'} /><PlayingCard size={mine ? 'lg' : 'md'} /></>}
        {p.cards.length > 0 && <span className="value">{p.value}</span>}
      </div>
      <div className="bj-note">
        {phase === 'result' && p.outcome
          ? <span className={`tag ${p.outcome}`}>{OUTCOME[p.outcome]}{p.payout > 0 ? ` · +${fmt(p.payout)}` : ''}</span>
          : active ? <span className="tag turn">Ходит</span>
          : STATUS[p.status] ? <span className="tag">{STATUS[p.status]}</span> : null}
      </div>
    </div>
  );
}

function Table({ id }) {
  const { user, balance } = useApp();
  const s = useRoom(id);
  const [bet, setBet] = useState(null);
  if (!s) return <div className="page"><Empty>Подключаемся к столу…</Empty></div>;

  const presets = [1, 2, 5, 10, 25, 50, 100].map((m) => s.min * m).filter((v) => v <= s.max);
  const amount = bet ?? presets[1];
  const me = s.players[s.me];
  const myTurn = s.phase === 'playing' && s.turn === s.me;
  const others = s.players.filter((_, i) => i !== s.me);
  const alone = s.online === 1;

  return (
    <div className="page game-page bj">
      <div className="felt">
        <div className="dealer">
          <span className="muted small">Дилер{s.dealer.length ? ` · ${s.dealerValue}` : ''}</span>
          <div className="cards">
            {s.dealer.length ? s.dealer.map((c, i) => <PlayingCard key={i} card={c} size="lg" />)
              : <><PlayingCard size="lg" /><PlayingCard size="lg" /></>}
          </div>
        </div>
        <TimerBar endsAt={s.endsAt} total={s.phase === 'betting' ? 12000 : s.phase === 'playing' ? 20000 : 5000} />
        {others.length > 0 && (
          <div className="bj-others">
            {others.map((p) => <Hand key={p.id} p={p} phase={s.phase} active={s.phase === 'playing' && s.players[s.turn]?.id === p.id} />)}
          </div>
        )}
        {me && <Hand p={me} mine phase={s.phase} active={myTurn} />}
      </div>

      <div className="dock sticky">
        {s.phase === 'betting' && !me && (
          <>
            <div className="dock-row">
              <span className="muted small">Ставка · {fmt(s.min)}–{fmt(s.max)}</span>
              {s.endsAt && <span className="muted small">Раздача через <Seconds endsAt={s.endsAt} /> с</span>}
            </div>
            <BetPicker values={presets} value={amount} onChange={setBet} max={balance} />
            <button className="btn primary lg" disabled={balance < amount || s.players.length >= s.maxPlayers}
              onClick={() => socket.act('bet', { amount })}>
              {s.players.length >= s.maxPlayers ? 'Все места заняты' : `Поставить · ${fmt(amount)}`}
            </button>
          </>
        )}
        {s.phase === 'betting' && me && (
          alone
            ? <button className="btn primary lg" onClick={() => socket.act('deal')}>Раздать</button>
            : <div className="dock-note">Ждём ставки других игроков · <Seconds endsAt={s.endsAt} /> с</div>
        )}
        {myTurn && (
          <div className="actions">
            <button className="btn lg" onClick={() => socket.act('stand')}>Хватит</button>
            <button className="btn lg" disabled={me.cards.length !== 2 || balance < me.bet} onClick={() => socket.act('double')}>Удвоить</button>
            <button className="btn primary lg" onClick={() => socket.act('hit')}>Ещё</button>
          </div>
        )}
        {s.phase !== 'betting' && !myTurn && (
          <div className="dock-note">
            {s.phase === 'playing' ? `Ходит ${s.players[s.turn]?.name ?? ''}`
              : s.phase === 'dealer' ? 'Дилер добирает карты'
              : me ? 'Раунд завершён' : 'Идёт раунд — ставки откроются через пару секунд'}
          </div>
        )}
      </div>
      <p className="muted small center">
        <Icon name="users" size={13} /> {s.online} за столом · блекджек 3:2 · дилер стоит на 17
      </p>
    </div>
  );
}

export default function Blackjack({ id }) {
  if (id) return <Table id={id} />;
  return (
    <TableList game="blackjack" render={(t) => (
      <>
        <div className="grow">
          <b>{t.name}</b>
          <span className="muted small">Ставки {fmt(t.min)} – {fmt(t.max)}</span>
        </div>
        <span className="pill"><Icon name="users" size={14} />{t.online}</span>
      </>
    )} />
  );
}
