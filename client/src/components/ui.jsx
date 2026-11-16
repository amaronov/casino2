import { useEffect } from 'react';
import { useCountdown, fmt } from '../lib/store.jsx';

// ── Иконки (линейные, 24×24) ────────────────────────────────────────────────
const PATHS = {
  home: <><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></>,
  trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 6H4.5v1A3.5 3.5 0 0 0 8 10.5M16 6h3.5v1a3.5 3.5 0 0 1-3.5 3.500M12 13v4M8.500 20h7M10 17h4v3h-4z" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.500 20c1-3.500 4-5 7.500-5s6.500 1.500 7.500 5" /></>,
  back: <path d="M14.500 5 8 12l6.500 7" />,
  gift: <><rect x="3.500" y="9" width="17" height="11" rx="2" /><path d="M2.500 9h19M12 9v11M12 9c-1.500-4-6-4-6-1.500S9 9 12 9Zm0 0c1.500-4 6-4 6-1.500S15 9 12 9Z" /></>,
  logout: <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" />,
  edit: <path d="m4 20 1-4L16 5l3 3L8 19l-4 1ZM14 7l3 3" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.500M12 7.500v.500" /></>,
  users: <><circle cx="9" cy="8.500" r="3.500" /><path d="M2.500 19.500c.800-3 3.200-4.500 6.500-4.500s5.700 1.500 6.500 4.500M16 5.500a3.500 3.500 0 0 1 0 6.500M18.500 15.500c1.600.700 2.600 2 3 4" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  slots: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M9 5v14M15 5v14M5.500 12h1M11.500 12h1M17.500 12h1" /></>,
  roulette: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6M3 12h6M15 12h6" /></>,
  blackjack: <><rect x="4" y="5" width="10" height="14" rx="2" transform="rotate(-8 9 12)" /><rect x="10.500" y="5" width="10" height="14" rx="2" transform="rotate(8 15.500 12)" /></>,
  poker: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.500" /><path d="M12 3v4.500M12 16.500V21M3 12h4.500M16.500 12H21" /></>,
};

export function Icon({ name, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.700"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

// Фишка — знак игровой валюты.
export function Chip({ size = 16 }) {
  return (
    <svg className="chip-ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <circle cx="12" cy="12" r="5.500" fill="none" stroke="#0b0c11" strokeWidth="1.600" opacity=".55" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="#0b0c11" strokeWidth="2.200" opacity=".55" />
    </svg>
  );
}

export function Amount({ value, sign = false, size }) {
  const cls = sign ? (value > 0 ? 'pos' : value < 0 ? 'neg' : '') : '';
  return (
    <span className={`amount ${cls}`}>
      <Chip size={size} />
      {sign && value > 0 ? '+' : ''}{fmt(value)}
    </span>
  );
}

export function Avatar({ id = 0, name = '?', size = 36 }) {
  // Цвет аватара выводится из идентификатора игрока.
  const hue = [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="avatar" style={{
      width: size, height: size, fontSize: size * 0.42,
      background: `linear-gradient(135deg, hsl(${hue} 70% 62%), hsl(${(hue + 50) % 360} 70% 45%))`,
    }}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

// ── Игральная карта ─────────────────────────────────────────────────────────
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
export function PlayingCard({ card, size = 'md', dim = false }) {
  if (!card) return <span className={`pcard ${size} empty`} />;
  if (card === '??') return <span className={`pcard ${size} back`} />;
  const rank = card[0] === 'T' ? '10' : card[0];
  const red = card[1] === 'h' || card[1] === 'd';
  return (
    <span className={`pcard ${size} ${red ? 'red' : ''} ${dim ? 'dim' : ''}`}>
      <b>{rank}</b>
      <i>{SUIT[card[1]]}&#xFE0E;</i>
    </span>
  );
}

// Полоса обратного отсчёта.
export function TimerBar({ endsAt, total }) {
  const ms = useCountdown(endsAt);
  const pct = endsAt ? Math.min(100, (ms / total) * 100) : 0;
  return (
    <div className="timerbar" aria-hidden="true">
      <span style={{ width: pct + '%' }} className={ms < 5000 ? 'hot' : ''} />
    </div>
  );
}

export function Seconds({ endsAt }) {
  const ms = useCountdown(endsAt);
  return <>{Math.ceil(ms / 1000)}</>;
}

// Нижняя шторка.
export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="close" size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Выбор номинала ставки.
export function BetPicker({ values, value, onChange, max }) {
  return (
    <div className="betpicker" role="radiogroup" aria-label="Размер ставки">
      {values.map((v) => (
        <button key={v} role="radio" aria-checked={v === value} disabled={max != null && v > max}
          className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {v >= 1000 ? v / 1000 + 'K' : v}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
