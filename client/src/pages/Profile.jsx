import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp, fmt } from '../lib/store.jsx';
import { Amount, Avatar, Icon, Empty } from '../components/ui.jsx';
import { BonusCard } from './Lobby.jsx';

const GAME = { slots: 'Слоты', roulette: 'Рулетка', blackjack: 'Блекджек', poker: 'Покер' };
const PAGE = 20;

const dateTime = (ts) =>
  new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function NameEditor() {
  const { user, setUser, toast } = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.displayName);
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api('/me', { method: 'PATCH', body: { displayName: name } });
      setUser(r.user);
      setEditing(false);
      toast('Имя обновлено', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="name-line">
        <h1>{user.displayName}</h1>
        <button className="icon-btn" onClick={() => { setName(user.displayName); setEditing(true); }} aria-label="Изменить имя">
          <Icon name="edit" size={17} />
        </button>
      </div>
    );
  }
  return (
    <form className="name-form" onSubmit={save}>
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus minLength={2} maxLength={20} aria-label="Новое имя" />
      <button className="btn primary sm" disabled={busy || name.trim().length < 2}>Сохранить</button>
      <button type="button" className="btn sm" onClick={() => setEditing(false)}>Отмена</button>
    </form>
  );
}

export default function Profile() {
  const { user, balance, signOut } = useApp();
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (offset) => {
    setLoading(true);
    try {
      const r = await api(`/history?limit=${PAGE}&offset=${offset}`);
      setItems((prev) => (offset ? [...prev, ...r.items] : r.items));
      setStats(r.stats);
      setMore(offset + r.items.length < r.stats.count);
    } catch { /* сообщение покажет общий обработчик */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(0); }, [load]);

  return (
    <div className="page">
      <section className="profile-head">
        <Avatar id={user.id} name={user.displayName} size={72} />
        <NameEditor />
        <span className="muted">@{user.username} · в игре с {new Date(user.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </section>

      <div className="stats">
        <div className="stat wide"><span className="muted small">Баланс</span><b><Amount value={balance} size={20} /></b></div>
        <div className="stat"><span className="muted small">Ставок</span><b>{fmt(stats?.count)}</b></div>
        <div className="stat"><span className="muted small">Поставлено</span><b>{fmt(stats?.wagered)}</b></div>
        <div className="stat"><span className="muted small">Выиграно</span><b>{fmt(stats?.won)}</b></div>
        <div className="stat"><span className="muted small">Лучший выигрыш</span><b className="pos">{fmt(stats?.biggestWin)}</b></div>
      </div>

      <BonusCard />

      <h2 className="section-title">История ставок</h2>
      <div className="list">
        {items.map((b) => {
          const net = b.payout - b.amount;
          return (
            <div className="row" key={b.id}>
              <div className="grow">
                <b>{GAME[b.game] || b.game}</b>
                <span className="muted small">{dateTime(b.createdAt)} · {b.detail}</span>
              </div>
              <div className="right">
                <Amount value={net} sign />
                <span className="muted small">ставка {fmt(b.amount)}</span>
              </div>
            </div>
          );
        })}
        {!items.length && !loading && <Empty>Ставок пока нет. Сыграйте — и история появится здесь.</Empty>}
        {loading && !items.length && <Empty>Загружаем…</Empty>}
      </div>
      {more && <button className="btn block" disabled={loading} onClick={() => load(items.length)}>Показать ещё</button>}

      <button className="btn block ghost" onClick={signOut}><Icon name="logout" size={18} /> Выйти из аккаунта</button>
    </div>
  );
}
