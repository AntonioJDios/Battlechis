import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send } from 'lucide-react';

// Fixed set of quick messages (no typing → easy for kids, no inappropriate text).
const PHRASES = [
  '¡Buena jugada! 👏',
  '¿Pactamos? 🤝',
  '¡No me ataques! 🙏',
  '¡Traidor! 😈',
  '¡Me las pagarás! 😤',
  '¡Cuidado! 👀',
  'GG 👍',
  '¡Jajaja! 😂',
  '¡Casi! 😅',
  '¡Toma ya! 🔥',
];
const EMOJIS = ['😂', '😱', '🔥', '💀', '😈', '👑', '🎲', '🤝', '😭', '🎉'];

export default function ChatPanel({ messages, onSend, onClose, myUid, myAccountId }) {
  const listRef = useRef(null);
  const [text, setText] = useState('');
  const submitText = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };
  // Keep scrolled to the newest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const isMine = (m) =>
    (m.sender_uid && m.sender_uid === myUid) ||
    (m.sender_account && myAccountId && m.sender_account === myAccountId);

  return (
    <div
      className="fixed z-[520] tactical-panel bg-[#0d101a]/95 border-slate-700 rounded-md shadow-[0_0_30px_rgba(0,0,0,0.8)] animate-fade-in"
      style={{ bottom: '12px', left: 0, right: 0, marginInline: 'auto', width: 'min(360px, calc(100vw - 24px))', height: 'min(460px, calc(100dvh - 90px))', display: 'flex', flexDirection: 'column' }}
    >
      <div className="panel-header bg-[#151a30] flex items-center justify-between">
        <span className="flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> CHAT</span>
        <button onClick={onClose} className="text-gray-500 hover:text-red-400 transition-colors text-base leading-none px-1">✕</button>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 scrollbar">
        {messages.length === 0 ? (
          <span className="text-gray-600 italic font-mono text-[10px] m-auto">Sin mensajes todavía. ¡Saluda! 👋</span>
        ) : (
          messages.map((m) => {
            const mine = isMine(m);
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '80%', display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                  {!mine && (
                    <span className="font-tactical text-[9px] text-cyan-400/80 px-1 leading-none mb-0.5">
                      {m.avatar || '🎖️'} {m.nickname || 'Jugador'}
                    </span>
                  )}
                  <div
                    className="font-mono text-[12px] leading-snug"
                    style={{
                      padding: '5px 9px', borderRadius: 10,
                      background: mine ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${mine ? 'rgba(34,211,238,0.35)' : 'rgba(255,255,255,0.08)'}`,
                      color: mine ? '#a5f3fc' : '#e5e7eb',
                      wordBreak: 'break-word',
                    }}
                  >
                    {m.body}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Quick messages + emojis */}
      <div className="border-t border-slate-800 p-2 flex flex-col gap-1.5">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {PHRASES.map((p) => (
            <button
              key={p}
              onClick={() => onSend(p)}
              className="font-tactical text-[10px] text-gray-200 hover:text-white"
              style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {p}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => onSend(e)}
              style={{ fontSize: 18, lineHeight: 1, padding: '3px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}
            >
              {e}
            </button>
          ))}
        </div>

        {/* Free text */}
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitText(); } }}
            maxLength={300}
            placeholder="Escribe un mensaje…"
            className="flex-1 font-mono text-[12px] text-white bg-slate-950 border border-slate-700 rounded px-2 py-1.5 outline-none focus:border-cyan-500/60"
          />
          <button
            onClick={submitText}
            disabled={!text.trim()}
            className="flex items-center justify-center rounded border border-cyan-500/50 bg-cyan-950/30 text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ width: 36, cursor: 'pointer' }}
            title="Enviar"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
