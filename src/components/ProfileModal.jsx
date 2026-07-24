import React, { useState, useEffect } from 'react';
import { UserRound, Check, X, Loader2, LogIn } from 'lucide-react';

// Identity without email: create a profile (unique name + password + avatar),
// or log in with name + password to use your profile on this device.
const AVATARS = ['🎖️','⭐','🔥','💀','🐉','🦅','🐺','🦁','🐻','🦊','👑','⚔️','🛡️','🚀','⚡','🎯','🐢','🦈','🤖','👽','🐙','🦖'];

export default function ProfileModal({ profile, onSave, checkNickname, setPassword, claimProfile, onLogout, onClose }) {
  const hasProfile = !!profile?.nickname;
  const [mode, setMode] = useState('edit'); // 'edit' (create/edit) | 'login'

  // edit
  const [nickname, setNickname] = useState(profile?.nickname || '');
  const [avatar, setAvatar] = useState(profile?.avatar || '🎖️');
  const [password, setPasswordVal] = useState('');
  const [avail, setAvail] = useState(null); // null | 'checking' | true | false
  // login
  const [loginName, setLoginName] = useState('');
  const [loginPass, setLoginPass] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);

  const initial = React.useRef({ nickname: profile?.nickname || '', avatar: profile?.avatar || '🎖️' });
  const dirty = mode === 'edit' && (nickname !== initial.current.nickname || avatar !== initial.current.avatar || password.length > 0);
  const name = nickname.trim();

  useEffect(() => {
    if (mode !== 'edit' || !checkNickname || name.length < 2 || name === initial.current.nickname.trim()) { setAvail(null); return; }
    setAvail('checking');
    const t = setTimeout(async () => { const r = await checkNickname(name); setAvail(r.ok ? true : false); }, 400);
    return () => clearTimeout(t);
  }, [name, checkNickname, mode]);

  const tryClose = () => {
    if (dirty && !window.confirm('Tienes cambios sin guardar. ¿Cerrar sin guardar?')) return;
    onClose();
  };

  const save = async () => {
    setBusy(true); setErr(null);
    const r = await onSave({ nickname, avatar });
    if (r && r.ok === false) { setBusy(false); setErr(r.msg || 'No se pudo guardar.'); return; }
    if (password.trim()) {
      const rp = await setPassword(password.trim());
      if (rp && rp.ok === false) { setBusy(false); setErr('Perfil guardado, pero la contraseña falló: ' + rp.msg); return; }
    }
    setBusy(false);
    initial.current = { nickname: name, avatar };
    setSaved(true);
    setTimeout(onClose, 700);
  };

  const login = async () => {
    setBusy(true); setErr(null);
    const r = await claimProfile(loginName, loginPass);
    setBusy(false);
    if (r && r.ok === false) { setErr(r.msg || 'No se pudo entrar.'); return; }
    setSaved(true);
    setTimeout(onClose, 700);
  };

  const doLogout = async () => {
    const warn = profile?.hasPassword
      ? '¿Cerrar sesión? Podrás volver a entrar con tu nombre y contraseña.'
      : '⚠️ No has puesto contraseña. Si cierras sesión PERDERÁS este perfil (no podrás volver a entrar). ¿Continuar?';
    if (!window.confirm(warn)) return;
    await onLogout();
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={tryClose}>
      <div
        className="animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(380px, 92vw)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', background: '#0f121d', border: '1px solid rgba(0,240,255,0.35)', borderRadius: 8, boxShadow: '0 0 40px rgba(0,240,255,0.2), 0 8px 32px rgba(0,0,0,0.7)' }}
      >
        <div style={{ background: 'rgba(5,40,60,0.9)', padding: '8px 12px', borderBottom: '1px solid rgba(0,240,255,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserRound className="w-4 h-4 text-cyan-400" />
          <span className="font-tactical text-[11px] text-cyan-400 font-bold uppercase tracking-widest flex-1">
            {mode === 'edit' ? (hasProfile ? 'Tu perfil' : 'Crea tu perfil') : 'Entrar con tu perfil'}
          </span>
          <button onClick={tryClose} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {mode === 'edit' ? (
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="flex items-center gap-3">
              <div style={{ fontSize: 40, lineHeight: 1, width: 56, textAlign: 'center' }}>{avatar}</div>
              <div className="flex-1">
                <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Nombre (único)</label>
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={20}
                  placeholder="Tu nombre"
                  className="w-full bg-[#121625] border border-cyan-500/40 text-white font-mono text-sm p-2 rounded focus:outline-none focus:border-cyan-400 mt-1"
                />
                <div className="h-3 mt-0.5">
                  {avail === 'checking' && <span className="font-mono text-[9px] text-gray-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> comprobando…</span>}
                  {avail === true && <span className="font-mono text-[9px] text-green-400">✓ disponible</span>}
                  {avail === false && <span className="font-mono text-[9px] text-red-400">✗ ya está cogido</span>}
                </div>
              </div>
            </div>

            <div>
              <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Avatar</label>
              <div className="grid grid-cols-8 gap-1 mt-1">
                {AVATARS.map((a) => (
                  <button key={a} onClick={() => setAvatar(a)} className={`text-xl rounded p-1 border transition-all ${avatar === a ? 'border-cyan-400 bg-cyan-950/40' : 'border-transparent hover:bg-slate-800'}`}>{a}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">
                {profile?.hasPassword ? 'Cambiar contraseña (opcional)' : 'Contraseña'}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPasswordVal(e.target.value)}
                placeholder={profile?.hasPassword ? '••••• (dejar vacío = no cambiar)' : 'Para usar tu perfil en otro móvil'}
                className="w-full bg-[#121625] border border-slate-700 text-white font-mono text-sm p-2 rounded focus:outline-none focus:border-cyan-400 mt-1"
              />
              <p className="font-mono text-[9px] text-gray-600 mt-1">Sin correo. Con tu nombre + contraseña entras en cualquier dispositivo.</p>
            </div>

            {err && <p className="font-mono text-[10px] text-red-400">{err}</p>}

            <button
              onClick={save}
              disabled={busy || saved || name.length < 2 || avail === false || avail === 'checking'}
              className={`btn-tactical py-2.5 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-40 ${saved ? 'border-green-400 text-green-400 bg-green-950/20' : 'border-cyan-400 text-cyan-400 bg-cyan-950/20 hover:bg-cyan-500/20'}`}
            >
              <Check className="w-4 h-4" /> {saved ? '✓ Guardado' : busy ? 'Guardando…' : (hasProfile ? 'Guardar' : 'Crear perfil')}
            </button>

            <button onClick={() => { setMode('login'); setErr(null); }} className="font-mono text-[10px] text-cyan-400/80 hover:text-cyan-300 underline text-center">
              ¿Ya tienes un perfil en otro dispositivo? Entrar
            </button>
            {hasProfile && onLogout && (
              <button onClick={doLogout} className="font-mono text-[10px] text-red-400/80 hover:text-red-300 text-center mt-1">
                Cerrar sesión / cambiar de usuario
              </button>
            )}
          </div>
        ) : (
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="font-mono text-[10px] text-gray-400 leading-relaxed">Escribe el <strong>nombre</strong> y la <strong>contraseña</strong> de tu perfil para usarlo aquí.</p>
            <div>
              <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Nombre</label>
              <input value={loginName} onChange={(e) => setLoginName(e.target.value)} placeholder="Tu nombre" className="w-full bg-[#121625] border border-cyan-500/40 text-white font-mono text-sm p-2 rounded focus:outline-none focus:border-cyan-400 mt-1" />
            </div>
            <div>
              <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Contraseña</label>
              <input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} placeholder="••••••" className="w-full bg-[#121625] border border-slate-700 text-white font-mono text-sm p-2 rounded focus:outline-none focus:border-cyan-400 mt-1" />
            </div>

            {err && <p className="font-mono text-[10px] text-red-400">{err}</p>}

            <button
              onClick={login}
              disabled={busy || saved || !loginName.trim() || !loginPass.trim()}
              className={`btn-tactical py-2.5 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-40 ${saved ? 'border-green-400 text-green-400 bg-green-950/20' : 'border-cyan-400 text-cyan-400 bg-cyan-950/20 hover:bg-cyan-500/20'}`}
            >
              <LogIn className="w-4 h-4" /> {saved ? '✓ ¡Bienvenido!' : busy ? 'Entrando…' : 'Entrar'}
            </button>

            <button onClick={() => { setMode('edit'); setErr(null); }} className="font-mono text-[10px] text-cyan-400/80 hover:text-cyan-300 underline text-center">
              ← Volver a crear / editar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
