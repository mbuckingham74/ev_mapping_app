import { useEffect, useState } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup: (email: string, password: string) => Promise<void>;
};

export default function AuthModal({ open, onClose, onLogin, onSignup }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'signup') {
        await onSignup(email.trim(), password);
      } else {
        await onLogin(email.trim(), password);
      }
      setPassword('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-100">
            {mode === 'signup' ? 'Create account' : 'Sign in'}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
          >
            Close
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={[
              'flex-1 rounded-md border px-3 py-1 text-xs font-semibold',
              mode === 'login'
                ? 'border-sky-500 bg-sky-600 text-white'
                : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700',
            ].join(' ')}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={[
              'flex-1 rounded-md border px-3 py-1 text-xs font-semibold',
              mode === 'signup'
                ? 'border-sky-500 bg-sky-600 text-white'
                : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700',
            ].join(' ')}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <label className="block">
            <div className="text-[11px] text-slate-300">Email</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>

          <label className="block">
            <div className="text-[11px] text-slate-300">Password</div>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Password'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </label>

          {error && (
            <div className="rounded-md border border-red-800 bg-red-900/40 px-3 py-2 text-xs text-red-100">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-300"
          >
            {submitting ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

