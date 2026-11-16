import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';
import { useApp, useRoom, fmt } from '../lib/store.jsx';
import { Amount, Avatar, BetPicker, Icon, Sheet, Empty } from '../components/ui.jsx';

const IDS = ['cherry', 'lemon', 'bell', 'star', 'diamond', 'seven'];
const NAMES = { cherry: 'Вишня', lemon: 'Лимон', bell: 'Колокол', star: 'Звезда', diamond: 'Алмаз', seven: 'Семёрка' };
const LINES = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]];

export function SlotSymbol({ id }) {
  const art = {
    cherry: <><path d="M20 12c-2 8-8 12-10 18M20 12c2 8 8 10 10 16" stroke="#4ade80" strokeWidth="2.500" fill="none" strokeLinecap="round" /><circle cx="11" cy="31" r="7" fill="#f43f5e" /><circle cx="29" cy="29" r="7" fill="#e11d48" /><circle cx="9" cy="29" r="2" fill="#fff" opacity=".5" /></>,
    lemon: <><ellipse cx="20" cy="21" rx="14" ry="10.500" fill="#fde047" transform="rotate(-25 20 21)" /><ellipse cx="16" cy="17" rx="4" ry="2.200" fill="#fff" opacity=".45" transform="rotate(-25 16 17)" /></>,
    bell: <><path d="M20 6c-6 0-9 5-9 11v6l-3 5h24l-3-5v-6c0-6-3-11-9-11Z" fill="#fbbf24" /><circle cx="20" cy="32" r="3" fill="#f59e0b" /><path d="M14 16c0-3 2-6 5-6.500" stroke="#fff" strokeWidth="2" fill="none" opacity=".5" strokeLinecap="round" /></>,
    star: <path d="m20 5 4.600 9.600 10.400 1.400-7.600 7.300 1.900 10.400L20 28.600l-9.300 5.100 1.900-10.400L5 16l10.400-1.400L20 5Z" fill="#a78bfa" />,
    diamond: <><path d="M10 8h20l6 9-16 18L4 17l6-9Z" fill="#38bdf8" /><path d="M4 17h32M14 8l-3 9 9 18 9-18-3-9" stroke="#e0f2fe" strokeWidth="1.200" fill="none" opacity=".7" /></>,
    seven: <path d="M9 7h23v5L20 35h-8l11-21H9V7Z" fill="#fb7185" stroke="#fecdd3" strokeWidth="1.200" />,
  };
  return <svg viewBox="0 0 40 40" className="sym">{art[id]}</svg>;
}

const randomGrid = () => [0, 1, 2].map(() => [0, 1, 2].map(() => IDS[Math.floor(Math.random() * IDS.length)]));

function Reel({ cells, spinning, wins, reel }) {
  // Лента случайных символов для анимации вращения.
  const strip = useMemo(() => Array.from({ length: 12 }, () => IDS[Math.floor(Math.random() * IDS.length)]), []);
  return (
    <div className="reel">
      {spinning ? (
        <div className="strip">{[...strip, ...strip].map((id, i) => <div className="cell" key={i}><SlotSymbol id={id} /></div>)}</div>
      ) : (
        <div className="landed">
          {cells.map((id, row) => (
            <div className={`cell ${wins.has(reel + ':' + row) ? 'win' : ''}`} key={row}><SlotSymbol id={id} /></div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Slots() {
  const { balance, holdBalance, user } = useApp();
  const room = useRoom('slots');
  const [bet, setBet] = useState(100);
  const [grid, setGrid] = useState(randomGrid);
  const [spinning, setSpinning] = useState([false, false, false]);
  const [result, setResult] = useState(null);
  const [paytable, setPaytable] = useState(null);
  const [showPays, setShowPays] = useState(false);
  const busy = useRef(false);
  // Лента зала не обновляется, пока крутятся свои барабаны, чтобы не выдать результат раньше времени.
  const [feed, setFeed] = useState([]);
  const roomRef = useRef(null);
  roomRef.current = room;
  useEffect(() => { if (room && !busy.current) setFeed(room.feed); }, [room]);
  const timers = useRef([]);

  const stop = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    busy.current = false;
    setSpinning([false, false, false]);
    holdBalance(false);
  };

  useEffect(() => {
    const offResult = socket.on('slots:result', (r) => {
      setGrid(r.grid);
      // Барабаны останавливаются по очереди слева направо.
      [500, 850, 1200].forEach((ms, i) =>
        timers.current.push(setTimeout(() => setSpinning((s) => s.map((v, j) => (j === i ? false : v))), ms)));
      timers.current.push(setTimeout(() => {
        setResult(r);
        busy.current = false;
        holdBalance(false);
        setFeed(roomRef.current?.feed ?? []);
      }, 1250));
    });
    const offError = socket.on('error', () => busy.current && stop());
    return () => { offResult(); offError(); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function spin() {
    if (busy.current || balance < bet) return;
    busy.current = true;
    setResult(null);
    holdBalance(true, balance - bet);
    setSpinning([true, true, true]);
    socket.act('spin', { bet });
  }

  const wins = useMemo(() => {
    const set = new Set();
    result?.wins.forEach((w) => LINES[w.line].forEach((row, reel) => set.add(reel + ':' + row)));
    return set;
  }, [result]);

  const anySpin = spinning.some(Boolean);
  const openPays = () => {
    setShowPays(true);
    if (!paytable) api('paytable').then(setPaytable).catch(() => {});
  };

  return (
    <div className="page game-page">
      <div className="machine">
        <div className="reels">
          {grid.map((cells, i) => <Reel key={i} reel={i} cells={cells} spinning={spinning[i]} wins={wins} />)}
        </div>
        <div className={`slot-status ${result?.payout ? 'won' : ''}`} aria-live="polite">
          {anySpin ? <span className="muted">Крутим…</span>
            : result ? (result.payout ? <>Выигрыш <Amount value={result.payout} sign /></> : <span className="muted">Не повезло — попробуйте ещё</span>)
            : <span className="muted">5 линий · три в ряд</span>}
        </div>
      </div>

      <div className="dock">
        <div className="dock-row">
          <span className="muted small">Ставка</span>
          <button className="link" onClick={openPays}><Icon name="info" size={15} /> Выплаты</button>
        </div>
        <BetPicker values={room?.bets || [10, 25, 50, 100, 250, 500, 1000, 2500]} value={bet} onChange={setBet} />
        <button className="btn primary lg" onClick={spin} disabled={anySpin || balance < bet}>
          {balance < bet && !anySpin ? 'Недостаточно фишек' : `Крутить · ${fmt(bet)}`}
        </button>
      </div>

      <h2 className="section-title">
        Зал сейчас <span className="pill"><Icon name="users" size={14} />{room?.online ?? 0}</span>
      </h2>
      <div className="list">
        {feed.length ? feed.map((f) => (
          <div className="row" key={f.id}>
            <Avatar id={f.userId} name={f.name} size={30} />
            <div className="grow"><b>{f.name}{f.userId === user.id ? ' (вы)' : ''}</b><span className="muted small">ставка {fmt(f.bet)}</span></div>
            {f.payout ? <Amount value={f.payout} sign /> : <span className="muted small">мимо</span>}
          </div>
        )) : <Empty>Пока тихо. Спины всех игроков зала появятся здесь.</Empty>}
      </div>

      {showPays && (
        <Sheet title="Таблица выплат" onClose={() => setShowPays(false)}>
          <p className="muted small">Ставка делится на 5 линий: три горизонтали и две диагонали. Выплата — множитель × ставка на линию ({fmt(bet / 5)}).</p>
          <div className="list tight">
            {(paytable?.symbols || []).slice().reverse().map((s) => (
              <div className="row" key={s.id}>
                <span className="pay-syms"><SlotSymbol id={s.id} /><SlotSymbol id={s.id} /><SlotSymbol id={s.id} /></span>
                <div className="grow"><b>{NAMES[s.id]}</b><span className="muted small">×{fmt(s.pays)}</span></div>
                <Amount value={(bet / 5) * s.pays} />
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
