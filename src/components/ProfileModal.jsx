import React, { useState } from 'react';
import { UserRound, Check, X } from 'lucide-react';

// Pick-your-identity modal: a nickname + an emoji avatar, no password.
// Saved per-device (localStorage) and mirrored to battlechis_profiles.
const AVATARS = ['🎖️','⭐','🔥','💀','🐉','🦅','🐺','🦁','🐻','🦊','👑','⚔️','🛡️','🚀','⚡','🎯','🐢','🦈','🤖','👽','🐙','🦖'];

export default function ProfileModal({ profile, onSave, onClose }) {
  const [nickname, setNickname] = useState(profile?.nickname || '');
  const [avatar, setAvatar] = useState(profile?.avatar || '🎖️');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    setBusy(true); setErr(null);
    const r = await onSave({ nickname, avatar });
    setBusy(false);
    if (r && r.ok === false) { setErr(r.msg || 'No se pudo guardar.'); return; }
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(380px, 92vw)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', background: '#0f121d', border: '1px solid rgba(0,240,255,0.35)', borderRadius: 8, boxShadow: '0 0 40px rgba(0,240,255,0.2), 0 8px 32px rgba(0,0,0,0.7)' }}
      >
        <div style={{ background: 'rgba(5,40,60,0.9)', padding: '8px 12px', borderBottom: '1px solid rgba(0,240,255,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserRound className="w-4 h-4 text-cyan-400" />
          <span className="font-tactical text-[11px] text-cyan-400 font-bold uppercase tracking-widest flex-1">Tu perfil</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="flex items-center gap-3">
            <div style={{ fontSize: 40, lineHeight: 1, width: 56, textAlign: 'center' }}>{avatar}</div>
            <div className="flex-1">
              <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Apodo</label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={20}
                placeholder="Tu nombre"
                className="w-full bg-[#121625] border border-cyan-500/40 text-white font-mono text-sm p-2 rounded focus:outline-none focus:border-cyan-400 mt-1"
              />
            </div>
          </div>

          <div>
            <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Avatar</label>
            <div className="grid grid-cols-8 gap-1 mt-1">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatar(a)}
                  className={`text-xl rounded p-1 border transition-all ${avatar === a ? 'border-cyan-400 bg-cyan-950/40' : 'border-transparent hover:bg-slate-800'}`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {err && <p className="font-mono text-[10px] text-red-400">{err}</p>}

          <button
            onClick={save}
            disabled={busy}
            className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 hover:bg-cyan-500/20 py-2.5 text-xs font-bold flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" /> {busy ? 'Guardando…' : 'Guardar perfil'}
          </button>
        </div>
      </div>
    </div>
  );
}
