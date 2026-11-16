import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';

export default function Auth() {
  const { signIn } = useApp();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isReg = mode === 'register';
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api(isReg ? '/auth/register' : '/auth/login', { method: 'POST', body: form });
      signIn(r.token, r.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="logo big">NOVA<span>casino</span></div>
        <p className="muted center">Слоты, рулетка, блекджек и покер с живыми игроками</p>

        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={!isReg} className={!isReg ? 'on' : ''} onClick={() => { setMode('login'); setError(''); }}>Вход</button>
          <button role="tab" aria-selected={isReg} className={isReg ? 'on' : ''} onClick={() => { setMode('register'); setError(''); }}>Регистрация</button>
        </div>

        <form onSubmit={submit} className="form">
          <label>
            <span>Логин</span>
            <input value={form.username} onChange={set('username')} autoComplete="username" autoCapitalize="none"
              placeholder="latin_login" required minLength={3} maxLength={16} />
          </label>
          {isReg && (
            <label>
              <span>Имя за столом</span>
              <input value={form.displayName} onChange={set('displayName')} placeholder="Как вас видят другие игроки" maxLength={20} />
            </label>
          )}
          <label>
            <span>Пароль</span>
            <input type="password" value={form.password} onChange={set('password')}
              autoComplete={isReg ? 'new-password' : 'current-password'} placeholder="Не короче 6 символов" required minLength={6} />
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn primary lg" disabled={busy}>
            {busy ? 'Секунду…' : isReg ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>
        {isReg && <p className="muted center small">На старте — 10 000 фишек. Игра идёт только на виртуальные фишки.</p>}
      </div>
    </div>
  );
}
