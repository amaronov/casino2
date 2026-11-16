import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp, go, fmt } from '../lib/store.jsx';
import { Icon, Amount } from '../components/ui.jsx';

export function BonusCard() {
  const { user, setUser, toast } = useApp();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const left = user.nextBonusAt - now;
  const ready = left <= 0;

  async function claim() {
    try {
      const r = await api('/bonus', { method: 'POST' });
      setUser(r.user);
      toast(`Бонус получен: +${fmt(r.bonus)}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const h = Math.floor(left / 3_600_000);
  const m = Math.ceil((left % 3_600_000) / 60_000);
  return (
    <div className={`bonus ${ready ? 'ready' : ''}`}>
      <span className="bonus-ico"><Icon name="gift" /></span>
      <div className="grow">
        <b>Ежедневный бонус</b>
        <span className="muted small">{ready ? '2 500 фишек ждут вас' : `Следующий через ${h > 0 ? h + ' ч ' : ''}${m} мин`}</span>
      </div>
      <button className="btn primary sm" disabled={!ready} onClick={claim}>Забрать</button>
    </div>
  );
}

const GAMES = [
  { id: 'slots', title: 'Слоты', sub: 'Общий зал, 5 линий', icon: 'slots' },
  { id: 'roulette', title: 'Рулетка', sub: 'Общий стол, раунды', icon: 'roulette' },
  { id: 'blackjack', title: 'Блекджек', sub: 'До 5 игроков', icon: 'blackjack' },
  { id: 'poker', title: 'Покер', sub: 'Техасский холдем', icon: 'poker' },
];

export default function Lobby() {
  const { user } = useApp();
  const [lobby, setLobby] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api('/lobby').then((r) => alive && setLobby(r)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const online = lobby && {
    slots: lobby.slots.online,
    roulette: lobby.roulette.online,
    blackjack: lobby.blackjack.reduce((s, t) => s + t.online, 0),
    poker: lobby.poker.reduce((s, t) => s + t.seated, 0),
  };

  return (
    <div className="page">
      <section className="hero">
        <span className="muted">Добро пожаловать,</span>
        <h1>{user.displayName}</h1>
      </section>
      <BonusCard />
      <h2 className="section-title">Игры</h2>
      <div className="games">
        {GAMES.map((g) => (
          <button key={g.id} className="game-card" data-accent={g.id} onClick={() => go(g.id)}>
            <span className="game-ico"><Icon name={g.icon} size={26} /></span>
            <b>{g.title}</b>
            <span className="muted small">{g.sub}</span>
            <span className="online"><i className={online?.[g.id] ? 'live' : ''} />{online ? online[g.id] : '—'} в игре</span>
          </button>
        ))}
      </div>

      {lobby && (
        <>
          <h2 className="section-title">Покерные столы</h2>
          <div className="list">
            {lobby.poker.map((t) => (
              <button key={t.id} className="row" onClick={() => go('poker/' + t.id)}>
                <div className="grow">
                  <b>{t.name}</b>
                  <span className="muted small">Блайнды {fmt(t.sb)} / {fmt(t.bb)}</span>
                </div>
                <span className="pill"><Icon name="users" size={14} />{t.seated}/{t.seats}</span>
                <Amount value={t.minBuy} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
