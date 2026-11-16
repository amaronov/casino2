import { useApp, useHashRoute, go } from './lib/store.jsx';
import { Amount, Icon } from './components/ui.jsx';
import Auth from './pages/Auth.jsx';
import Lobby from './pages/Lobby.jsx';
import Slots from './pages/Slots.jsx';
import Roulette from './pages/Roulette.jsx';
import Blackjack from './pages/Blackjack.jsx';
import Poker from './pages/Poker.jsx';
import Leaderboard from './pages/Leaderboard.jsx';
import Profile from './pages/Profile.jsx';

const TITLES = { slots: 'Слоты', roulette: 'Рулетка', blackjack: 'Блекджек', poker: 'Покер' };
const NAV = [
  ['', 'Игры', 'home'],
  ['leaders', 'Лидеры', 'trophy'],
  ['profile', 'Профиль', 'user'],
];

function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" aria-live="assertive">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>)}
    </div>
  );
}

export default function App() {
  const { user, loading, balance, online } = useApp();
  const [page = '', arg] = useHashRoute();

  if (loading) return <div className="splash"><div className="logo big">NOVA<span>casino</span></div></div>;
  if (!user) return <><Auth /><Toasts /></>;

  const isGame = page in TITLES;
  let view;
  if (page === 'slots') view = <Slots />;
  else if (page === 'roulette') view = <Roulette />;
  else if (page === 'blackjack') view = <Blackjack id={arg} key={arg} />;
  else if (page === 'poker') view = <Poker id={arg} key={arg} />;
  else if (page === 'leaders') view = <Leaderboard />;
  else if (page === 'profile') view = <Profile />;
  else view = <Lobby />;

  return (
    <div className="app" data-accent={isGame ? page : 'home'}>
      <header className="topbar">
        <div className="topbar-in">
          {isGame ? (
            <button className="icon-btn" onClick={() => go(arg ? page : '')} aria-label="Назад"><Icon name="back" /></button>
          ) : (
            <a className="logo" href="#/">NOVA<span>casino</span></a>
          )}
          {isGame && <h1 className="topbar-title">{TITLES[page]}</h1>}
          <button className="balance" onClick={() => go('profile')} aria-label="Баланс">
            <Amount value={balance} />
          </button>
        </div>
        {!online && <div className="offline">Переподключение к серверу…</div>}
      </header>

      <main>{view}</main>

      {!isGame && (
        <nav className="tabbar" aria-label="Основная навигация">
          {NAV.map(([path, label, icon]) => (
            <a key={path} href={'#/' + path} className={page === path ? 'on' : ''} aria-current={page === path ? 'page' : undefined}>
              <Icon name={icon} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
      )}
      <Toasts />
    </div>
  );
}
