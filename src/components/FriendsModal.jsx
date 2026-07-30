import React, { useEffect, useState } from 'react';
import { Users, X, Search, UserPlus, Check, Trash2, Loader2 } from 'lucide-react';

// Everything in-app: search people by their unique name, send a friend request,
// accept incoming requests, and see your circle ranked by wins.
export default function FriendsModal({
  profile, myUserId, searchProfiles, sendFriendRequest,
  listFriendRequests, acceptFriendRequest, rejectFriendRequest,
  fetchRanking, removeFriend, onClose,
}) {
  const [requests, setRequests] = useState(null);  // incoming friend requests
  const [ranking, setRanking] = useState(null);     // you + friends, sorted by wins
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);      // search results (null = idle)
  const [searching, setSearching] = useState(false);
  const [sent, setSent] = useState({});              // userId -> true after a request

  const noName = !profile?.nickname;

  const loadRanking = () => fetchRanking().then(setRanking).catch(() => setRanking([]));
  const loadRequests = () => listFriendRequests().then(setRequests).catch(() => setRequests([]));
  useEffect(() => { loadRanking(); loadRequests(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try { setResults(await searchProfiles(q)); } catch { setResults([]); }
      setSearching(false);
    }, 400);
    return () => clearTimeout(t);
  }, [query, searchProfiles]);

  const friendIds = new Set((ranking || []).filter((r) => r.user_id !== myUserId).map((r) => r.user_id));

  const request = async (u) => {
    const r = await sendFriendRequest(u.user_id);
    if (r.ok) { setSent((p) => ({ ...p, [u.user_id]: true })); if (r.accepted) loadRanking(); }
  };
  const accept = async (u) => { await acceptFriendRequest(u.user_id); setRequests((p) => (p || []).filter((x) => x.user_id !== u.user_id)); loadRanking(); };
  const reject = async (u) => { await rejectFriendRequest(u.user_id); setRequests((p) => (p || []).filter((x) => x.user_id !== u.user_id)); };
  const remove = async (f) => {
    if (!window.confirm(`¿Eliminar a ${f.nickname || 'este amigo'} de tus amigos? Dejaréis de estar enlazados.`)) return;
    const r = await removeFriend(f.user_id);
    if (!r || r.ok !== false) setRanking((p) => (p || []).filter((x) => x.user_id !== f.user_id));
  };

  return (
    <div className="py-6" style={{ position: 'fixed', inset: 0, zIndex: 600, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(0,0,0,0.85)' }} onClick={onClose}>
      <div
        className="animate-fade-in w-full max-w-md my-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#0f121d', border: '1px solid rgba(0,240,255,0.35)', borderRadius: 8, boxShadow: '0 0 40px rgba(0,240,255,0.2), 0 8px 32px rgba(0,0,0,0.7)' }}
      >
        <div style={{ background: 'rgba(5,40,60,0.9)', padding: '8px 12px', borderBottom: '1px solid rgba(0,240,255,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users className="w-4 h-4 text-cyan-400" />
          <span className="font-tactical text-[11px] text-cyan-400 font-bold uppercase tracking-widest flex-1">Amigos y ranking</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {noName && (
            <p className="font-mono text-[10px] text-amber-400 bg-amber-950/30 border border-amber-500/40 rounded px-2 py-1.5">
              Ponte un <strong>nombre</strong> en tu perfil (👤) para que tus amigos puedan encontrarte.
            </p>
          )}

          {/* Incoming requests */}
          {requests && requests.length > 0 && (
            <div>
              <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Solicitudes recibidas</label>
              <div className="flex flex-col gap-1.5 mt-1">
                {requests.map((u) => (
                  <div key={u.user_id} className="flex items-center gap-2 bg-[#0d101a] border border-amber-500/30 rounded px-2 py-1.5">
                    <span className="text-lg shrink-0">{u.avatar || '🎖️'}</span>
                    <span className="font-tactical text-[12px] text-white flex-1 truncate">{u.nickname || 'Comandante'}</span>
                    <button onClick={() => accept(u)} className="py-1 px-2 text-[10px] font-bold rounded border border-green-500/50 text-green-300 bg-green-950/20 hover:bg-green-900/30 shrink-0">Aceptar</button>
                    <button onClick={() => reject(u)} className="p-1 text-slate-600 hover:text-red-400 shrink-0"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          <div>
            <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Buscar amigos por nombre</label>
            <div className="flex items-center gap-2 mt-1 bg-[#121625] border border-slate-800 rounded px-2 focus-within:border-cyan-500">
              <Search className="w-4 h-4 text-slate-500 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Escribe un nombre…"
                className="flex-1 min-w-0 bg-transparent text-white font-mono text-sm py-2 focus:outline-none"
              />
              {searching && <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />}
            </div>
            {results && (
              <div className="flex flex-col gap-1.5 mt-1.5">
                {results.length === 0 ? (
                  <p className="font-mono text-[10px] text-gray-500 py-1">Nadie con ese nombre.</p>
                ) : results.map((u) => {
                  const already = friendIds.has(u.user_id);
                  const done = sent[u.user_id];
                  return (
                    <div key={u.user_id} className="flex items-center gap-2 bg-[#0d101a] border border-slate-900 rounded px-2 py-1.5">
                      <span className="text-lg shrink-0">{u.avatar || '🎖️'}</span>
                      <span className="font-tactical text-[12px] text-white flex-1 truncate">{u.nickname}</span>
                      {already ? (
                        <span className="font-mono text-[9px] text-green-400 shrink-0">ya es amigo</span>
                      ) : (
                        <button
                          onClick={() => request(u)}
                          disabled={done}
                          className={`py-1 px-2 text-[10px] font-bold rounded border flex items-center gap-1 shrink-0 ${done ? 'border-green-500/40 text-green-400 bg-green-950/20' : 'border-cyan-400/50 text-cyan-300 bg-cyan-950/20 hover:bg-cyan-900/30'}`}
                        >
                          {done ? <><Check className="w-3 h-3" /> Enviada</> : <><UserPlus className="w-3 h-3" /> Solicitar</>}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Ranking = your circle (you + friends) */}
          <div>
            <label className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">🏆 Ranking · tu círculo</label>
            <div className="flex flex-col gap-1.5 mt-1">
              {ranking === null ? (
                <div className="flex items-center justify-center gap-2 py-4 text-cyan-400 font-mono text-[11px]"><Loader2 className="w-4 h-4 animate-spin" /> Cargando…</div>
              ) : ranking.length === 0 ? (
                <p className="font-mono text-[11px] text-gray-500 text-center py-4">Busca a tus amigos arriba para empezar 👆</p>
              ) : ranking.map((f, i) => {
                const isMe = f.user_id === myUserId;
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                return (
                  <div key={f.user_id} className={`flex items-center gap-2 rounded px-2 py-1.5 border ${isMe ? 'border-cyan-500/50 bg-cyan-950/20' : 'border-slate-900 bg-[#0d101a]'}`}>
                    <span className="font-tactical text-xs text-gray-400 w-6 text-center shrink-0">{medal}</span>
                    <span className="text-lg shrink-0">{f.avatar || '🎖️'}</span>
                    <span className={`font-tactical text-[12px] flex-1 truncate ${isMe ? 'text-cyan-300' : 'text-white'}`}>{f.nickname || 'Comandante'}{isMe ? ' (tú)' : ''}</span>
                    <span className="font-mono text-[11px] text-yellow-400 shrink-0">🏆 {f.games_won}</span>
                    <span className="font-mono text-[9px] text-gray-500 shrink-0">/ {f.games_played}</span>
                    {!isMe && <button onClick={() => remove(f)} title="Eliminar amigo" className="p-1.5 border border-red-500/40 rounded text-red-400/90 hover:text-red-300 hover:bg-red-900/30 transition-all shrink-0"><Trash2 className="w-4 h-4" /></button>}
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
