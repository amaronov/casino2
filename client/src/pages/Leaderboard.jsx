import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { Amount, Avatar, Empty } from '../components/ui.jsx';

const TABS = [
  ['balance', 'Баланс'],
  ['win', 'Крупный выигрыш'],
  ['profit', 'Профит'],
];

function Row({ r, me, signed }) {
  return (
    <div className={`row ${me ? 'me' : ''}`}>
      <span className={`rank r${r.rank}`}>{r.rank}</span>
      <Avatar id={r.id} name={r.name} size={34} />
      <div className="grow"><b>{r.name}{me ? ' (вы)' : ''}</b></div>
      <Amount value={r.value} sign={signed} />
    </div>
  );
}

export default function Leaderboard() {
  const { user } = useApp();
  const [by, setBy] = useState('balance');
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    const load = () => api('leaderboard', { by }).then((r) => alive && setData(r)).catch(() => {});
    load();
    const t = setInterval(() => document.hidden || load(), 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [by]);

  const inTop = data?.top.some((r) => r.id === user.id);
  return (
    <div className="page">
      <section className="hero"><h1>Лидеры</h1><span className="muted">Лучшие игроки казино</span></section>
      <div className="segmented" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={by === id} className={by === id ? 'on' : ''} onClick={() => setBy(id)}>{label}</button>
        ))}
      </div>
      <div className="list">
        {!data ? <Empty>Загружаем…</Empty>
          : data.top.length ? data.top.map((r) => <Row key={r.id} r={r} me={r.id === user.id} signed={by !== 'balance'} />)
          : <Empty>Пока никто не сыграл. Станьте первым.</Empty>}
      </div>
      {data?.me && !inTop && (
        <div className="list pinned"><Row r={data.me} me signed={by !== 'balance'} /></div>
      )}
    </div>
  );
}
