import React, { useState, useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import { showSystemNotificationSafely } from '../utils/platform';
import './Chat.css';

export default function Chat({ tripId, currentUser, partnerName, onNewMessage }) {
  const { t } = useTranslation();
  const defaultPartnerName = partnerName || t('matches.passenger');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const prevLengthRef = useRef(0);

  useEffect(() => {
    if (!currentUser || !tripId) return undefined;

    prevLengthRef.current = 0;
    const unsubscribe = api.subscribeTripMessages(tripId, (msgs) => {
      setMessages(msgs);
      // Уведомляем о новых входящих сообщениях
      if (msgs.length > prevLengthRef.current) {
        const newMsgs = msgs.slice(prevLengthRef.current);
        const hasIncoming = newMsgs.some(m => m.senderId !== currentUser.id);
        if (hasIncoming && onNewMessage) {
          onNewMessage();
          const last = newMsgs.find(m => m.senderId !== currentUser.id);
          if (last) {
            showSystemNotificationSafely(`Новое сообщение от ${last.senderName}`, { body: last.text });
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
      const created = await api.sendChatMessage(tripId, text);
      if (created?.id != null) {
        const nextMsg = {
          id: created.id,
          senderId: created.sender_id ?? currentUser.id,
          senderName: created.sender?.name || currentUser.name || 'Пользователь',
          text: created.text ?? text,
          time: created.timestamp || '',
        };
        setMessages((prev) => (
          prev.some((m) => m.id === nextMsg.id) ? prev : [...prev, nextMsg]
        ));
      }
    } catch (_) {
      // Возвращаем текст в поле, чтобы сообщение не потерялось.
      setInput(text);
    }
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

    </div>
  );
}
