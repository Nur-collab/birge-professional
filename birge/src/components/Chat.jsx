import React, { useState, useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';

export default function Chat({ tripId, currentUser, partnerName, onNewMessage }) {
  const { t } = useTranslation();
  const defaultPartnerName = partnerName || t('matches.passenger');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const prevLengthRef = useRef(0);

  useEffect(() => {
    if (!currentUser || !tripId) return;

    // Подписываемся на сообщения через Firestore onSnapshot (вместо WebSocket)
    const unsubscribe = api.subscribeTripMessages(tripId, (msgs) => {
      setMessages(msgs);
      // Уведомляем о новых входящих сообщениях
      if (msgs.length > prevLengthRef.current) {
        const newMsgs = msgs.slice(prevLengthRef.current);
        const hasIncoming = newMsgs.some(m => m.senderId !== currentUser.id);
        if (hasIncoming && onNewMessage) {
          onNewMessage();
          // Push-уведомление если вкладка скрыта
          if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
            const last = newMsgs.find(m => m.senderId !== currentUser.id);
            if (last) new Notification(`Новое сообщение от ${last.senderName}`, { body: last.text });
          }
        }
      }
      prevLengthRef.current = msgs.length;
    });

    return () => unsubscribe();
  }, [tripId, currentUser?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!currentUser || !tripId) return null;

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const text = input.trim();
    setInput('');
    try {
      await api.sendChatMessage(tripId, text);
    } catch (_) {
      // Возвращаем текст в поле, чтобы сообщение не потерялось.
      setInput(text);
      return;
    }
    try {
      // Подстраховка на случай, если WebSocket-бродкаст не дошёл.
      const fresh = await api.getTripMessages(tripId);
      setMessages(fresh);
    } catch (_) {}
  };

  return (
    <div className="chat glass-panel">
      <div className="chat-messages" role="log" aria-live="polite" aria-label={t('trip.chat')}>
        {messages.length === 0 ? (
          <div className="chat-empty">{t('trip.type_message')}</div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.senderId === currentUser.id;
            return (
              <div key={msg.id} className={`message ${isMe ? 'message-sent' : 'message-received'}`}>
                {!isMe && <span className="message-sender">{msg.senderName || defaultPartnerName}</span>}
                <div className="message-bubble">{msg.text}</div>
                <span className="message-time">{msg.time}</span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-area" onSubmit={sendMessage}>
        <input
          type="text"
          aria-label={t('trip.type_message')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('trip.type_message')}
          className="chat-input"
        />
        <button type="submit" className="chat-send-btn" disabled={!input.trim()} aria-label={t('trip.send')}>
          <Send size={18} aria-hidden="true" />
        </button>
      </form>

      <style>{`
        .chat { display: flex; flex-direction: column; height: 100%; min-height: 250px; max-height: 400px; padding: 0; overflow: hidden; }
        .chat-messages { flex: 1; padding: 15px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; scrollbar-width: thin; }
        .chat-empty { text-align: center; color: var(--text-muted); margin-top: auto; margin-bottom: auto; font-size: 0.9rem; }
        .message { display: flex; flex-direction: column; max-width: 85%; }
        .message-sent { align-self: flex-end; align-items: flex-end; }
        .message-received { align-self: flex-start; align-items: flex-start; }
        .message-sender { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 2px; margin-left: 4px; }
        .message-bubble { padding: 10px 14px; border-radius: 16px; font-size: 0.95rem; line-height: 1.4; box-shadow: 0 2px 5px var(--shadow-soft); }
        .message-sent .message-bubble { background: linear-gradient(135deg, var(--primary), var(--primary-hover)); color: var(--on-primary); border-bottom-right-radius: 4px; }
        .message-received .message-bubble { background: var(--bg-subtle); color: var(--text-main); border-bottom-left-radius: 4px; border: 1px solid var(--border-subtle); }
        .message-time { font-size: 0.7rem; color: var(--text-subtle); margin-top: 4px; }
        .chat-input-area { display: flex; padding: 12px; background: var(--bg-card); border-top: 1px solid var(--bg-subtle); gap: 8px; }
        .chat-input { flex: 1; border: 1px solid var(--border-subtle); border-radius: 20px; padding: 10px 16px; outline: none; background: var(--bg-input); color: var(--text-main); font-size: 0.95rem; transition: all 0.2s; }
        .chat-input:focus { background: var(--bg-card); border-color: var(--primary); }
        .chat-input:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 2px; }
        .chat-send-btn { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), var(--primary-hover)); color: var(--on-primary); border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
        .chat-send-btn:disabled { background: var(--border-subtle); color: var(--text-subtle); cursor: not-allowed; }
      `}</style>
    </div>
  );
}
