import React, { useEffect, useState } from 'react';
import { Users, X, Share2, Check, UserPlus, Trash2, Loader2 } from 'lucide-react';

// Friends + ranking in one place: share your link, add by code, and see your
// circle (you + friends) ranked by wins.
export default function FriendsModal({ profile, myUserId, addFriendByCode, fetchRanking, removeFriend, onClose }) {
  const [rows, setRows] = useState(null); // ranking rows (you + friends), sorted by wins
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // { ok, text }
  const [copied, setCopied] = useState(false);

  const friendCode = profile?.friendCode || null;
  const friendLink = friendCode ? `${window.location.origin}/?friend=${friendCode}` : '';

  const load = () => { fetchRanking().then(setRows).catch(() => setRows([])); };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const share = async () => {
    if (!friendLink) return;
    try {
      if (navigator.share) { await navigator.share({ title: 'BattleChis', text: '¡Añádeme en BattleChis!', url: friendLink }); return; }
    } catch { return; }
    try { await navigator.clipboard.writeText(friendLink); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  const add = async () => {
    setBusy(true); setMsg(null);
    const r = await addFriendByCode(code);
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: `¡Añadido ${r.friend?.nickname || ''} ${r.friend?.avatar || ''}!` }); setCode(''); load(); }
    else setMsg({ ok: false, text: r.msg });
  };

  const remove = async (id) => {
    await removeFriend(id);
    setRows((prev) => (prev || []).filter((f) => f.user_id !== id));
  };

  const friendCount = rows ? rows.filter((r) => r.user_id !== myUserId).length : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(400px, 94vw)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', background: '#0f121d', border: '1px solid rgba(0,240,255,0.35)', borderRadius: 8, boxShadow: '0 0 40px rgba(0,240,255,0.2), 0 8px 32px rgba(0,0,0,0.7)' }}
      >
        <div style={{ background: 'rgba(5,40,60,0.9)', padding: '8px 12px', borderBottom: '1px solid rgba(0,240,255,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users className="w-4 h-4 text-cyan-400" />
          <span className="font-tactical text-[11px] text-cyan-400 font-bold uppercase tracking-widest flex-1">Amigos y ranking</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Your friend link */}
          <div>
            <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Tu enlace de amigo</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                readOnly
                value={friendLink || 'Generando…'}
                onFocus={(e) => e.target.select()}
                className="flex-1 bg-[#0a0d16] border border-slate-800 rounded px-2 py-1.5 font-mono text-[10px] text-cyan-300 focus:outline-none focus:border-cyan-500 min-w-0"
              />
              <button
                onClick={share}
                disabled={!friendLink}
                className="btn-tactical border-cyan-400 text-cyan-400 bg-cyan-950/20 hover:bg-cyan-500/20 py-1.5 px-3 text-[11px] font-bold flex items-center gap-1 shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Share2 className="w-3.5 h-3.5" />}
                {copied ? '¡Copiado!' : 'Compartir'}
              </button>
            </div>
            <p className="font-mono text-[9px] text-gray-600 mt-1">Quien abra tu enlace te añade al instante (código: <span className="text-cyan-400">{friendCode || '…'}</span>).</p>
          </div>

          {/* Add by code */}
          <div>
            <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Añadir por código</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Ej. AM7K9"
                maxLength={6}
                className="flex-1 min-w-0 bg-[#121625] border border-slate-800 text-cyan-400 font-tactical text-lg tracking-[4px] text-center p-1.5 rounded focus:outline-none focus:border-cyan-500 uppercase"
              />
              <button
                onClick={add}
                disabled={busy || !code.trim()}
                className="btn-tactical border-green-400 text-green-400 bg-green-950/20 hover:bg-green-500/20 py-1.5 px-3 text-[11px] font-bold flex items-center gap-1 shrink-0"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Añadir
              </button>
            </div>
            {msg && <p className={`font-mono text-[10px] mt-1 ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
          </div>

          {/* Ranking = your circle (you + friends), sorted by wins */}
          <div>
            <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">🏆 Ranking · tu círculo{friendCount > 0 ? ` (${friendCount} amigo${friendCount !== 1 ? 's' : ''})` : ''}</label>
            <div className="flex flex-col gap-1.5 mt-1">
              {rows === null ? (
                <div className="flex items-center justify-center gap-2 py-4 text-cyan-400 font-mono text-[11px]"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div>
              ) : rows.length === 0 ? (
                <p className="font-mono text-[11px] text-gray-500 text-center py-4">Comparte tu enlace para tener con quién competir 👆</p>
              ) : rows.map((f, i) => {
                const isMe = f.user_id === myUserId;
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                return (
                  <div key={f.user_id} className={`flex items-center gap-2 rounded px-2 py-1.5 border ${isMe ? 'border-cyan-500/50 bg-cyan-950/20' : 'border-slate-900 bg-[#0d101a]'}`}>
                    <span className="font-tactical text-xs text-gray-400 w-6 text-center shrink-0">{medal}</span>
                    <span className="text-lg shrink-0">{f.avatar || '🎖️'}</span>
                    <span className={`font-tactical text-[12px] flex-1 truncate ${isMe ? 'text-cyan-300' : 'text-white'}`}>{f.nickname || 'Comandante'}{isMe ? ' (tú)' : ''}</span>
                    <span className="font-mono text-[11px] text-yellow-400 shrink-0">🏆 {f.games_won}</span>
                    <span className="font-mono text-[9px] text-gray-500 shrink-0">/ {f.games_played}</span>
                    {!isMe && (
                      <button onClick={() => remove(f.user_id)} title="Eliminar amigo" className="p-1 text-slate-600 hover:text-red-400 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
