import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket.js';
import { useApp, useRoom, fmt, compact } from '../lib/store.jsx';
import { Amount, Avatar, BetPicker, Icon, Seconds, TimerBar, Empty } from '../components/ui.jsx';

const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const color = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
const SEG = 360 / WHEEL.length;
const FILL = { green: '#10b981', red: '#e11d48', black: '#1b1e29' };
const CONIC = `conic-gradient(from ${-SEG / 2}deg, ${WHEEL.map((n, i) => `${FILL[color(n)]} ${i * SEG}deg ${(i + 1) * SEG}deg`).join(', ')})`;

function Wheel({ phase, result, endsAt }) {
  const [rot, setRot] = useState(0);
  const turns = useRef(0);
  useEffect(() => {
    if (phase === 'spinning' && result != null) {
      turns.current += 1;
      // Колесо всегда крутится вперёд и останавливается выпавшим числом под указателем.
      setRot(-(turns.current * 360 * 4 + WHEEL.indexOf(result) * SEG));
    }
  }, [phase, result]);

  return (
    <div className="wheel-wrap">
      <div className="wheel-pointer" />
      <div className="wheel" style={{ transform: `rotate(${rot}deg)`, background: CONIC }}>
        {WHEEL.map((n, i) => (
          <span key={n} style={{ transform: `rotate(${i * SEG}deg)` }}>{n}</span>
        ))}
      </div>
      <div className="wheel-hub">
        {phase === 'result' ? <b className={`res ${color(result)}`}>{result}</b>
          : phase === 'spinning' ? <span className="muted small">Крутим…</span>
          : <><b><Seconds endsAt={endsAt} /></b><span className="muted small">ставки</span></>}
      </div>
    </div>
  );
}

export default function Roulette() {
  const { user, balance } = useApp();
  const s = useRoom('roulette');
  const [chip, setChip] = useState(50);
  if (!s) return <div className="page"><Empty>Подключаемся к столу…</Empty></div>;

  const open = s.phase === 'betting';
  const place = (key) => open && socket.act('bet', { key, amount: chip });
  const Cell = ({ k, children, className = '' }) => (
    <button className={`rcell ${className}`} disabled={!open} onClick={() => place(k)}>
      {children}
      {s.myBets[k] ? <em>{compact(s.myBets[k])}</em> : null}
    </button>
  );

  return (
    <div className="page game-page roulette">
      <div className="split">
        <div>
          <Wheel phase={s.phase} result={s.result} endsAt={s.endsAt} />
          <TimerBar endsAt={open ? s.endsAt : null} total={20000} />
          <div className={`round-status ${s.phase === 'result' && s.myPayout > 0 ? 'won' : ''}`} aria-live="polite">
            {s.phase === 'betting' && (s.myTotal ? <>Ваша ставка <Amount value={s.myTotal} /></> : <span className="muted">Выберите фишку и нажмите на поле</span>)}
            {s.phase === 'spinning' && <span className="muted">Ставки сделаны</span>}
            {s.phase === 'result' && (s.myPayout == null ? <span className="muted">Выпало {s.result}</span>
              : s.myPayout > 0 ? <>Выигрыш <Amount value={s.myPayout} sign /></> : <span className="muted">Выпало {s.result} — ставка не сыграла</span>)}
          </div>
          <div className="history" aria-label="Последние числа">
            {s.history.map((n, i) => <span key={i} className={color(n)}>{n}</span>)}
          </div>
        </div>

        <div>
          <div className="rtable">
            <Cell k="n:0" className="green zero">0</Cell>
            {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => <Cell key={n} k={'n:' + n} className={color(n)}>{n}</Cell>)}
            {[1, 2, 3].map((c) => <Cell key={c} k={'c:' + c} className="out">2 к 1</Cell>)}
          </div>
          <div className="rtable outside">
            {[1, 2, 3].map((d) => <Cell key={d} k={'d:' + d} className="out">{d}-я дюжина</Cell>)}
            <Cell k="low" className="out">1–18</Cell>
            <Cell k="even" className="out">Чёт</Cell>
            <Cell k="red" className="out"><i className="dot red" />Красное</Cell>
            <Cell k="black" className="out"><i className="dot black" />Чёрное</Cell>
            <Cell k="odd" className="out">Нечёт</Cell>
            <Cell k="high" className="out">19–36</Cell>
          </div>
        </div>
      </div>

      <div className="dock sticky">
        <div className="dock-row">
          <span className="muted small">Номинал фишки</span>
          <button className="link" disabled={!open || !s.myTotal} onClick={() => socket.act('clear')}>Снять ставки</button>
        </div>
        <BetPicker values={[10, 50, 100, 500, 1000, 5000]} value={chip} onChange={setChip} max={balance} />
      </div>

      <h2 className="section-title">
        За столом <span className="pill"><Icon name="users" size={14} />{s.online}</span>
      </h2>
      <div className="list">
        {s.players.length ? s.players.map((p) => (
          <div className="row" key={p.id}>
            <Avatar id={p.id} name={p.name} size={30} />
            <div className="grow"><b>{p.name}{p.id === user.id ? ' (вы)' : ''}</b><span className="muted small">поставил {fmt(p.total)}</span></div>
            {p.payout != null && (p.payout > 0 ? <Amount value={p.payout} sign /> : <span className="muted small">мимо</span>)}
          </div>
        )) : <Empty>В этом раунде ставок пока нет</Empty>}
      </div>
    </div>
  );
}
