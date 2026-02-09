import React, { useRef, useEffect } from 'react';
import { useChat } from '../../contexts/ChatContext';
import MessageBubble from './MessageBubble';
import TypingBubble from './TypingBubble';

function MessageList() {
  const { messages, error, isLoading, textSize } = useChat();
  const messagesEndRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);

  // Debug logging (opt-in in dev only)
  useEffect(() => {
    const isDevHost = typeof window !== 'undefined' &&
      (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1');
    if (!isDevHost || !window?.__CHAT_DEBUG__) return;
    console.debug('MessageList render:', {
      messageCount: messages.length,
      isLoading,
      hasError: !!error
    });
  }, [messages, isLoading, error]);

  // Track whether user is near the bottom of the scroll container
  useEffect(() => {
    const scrollContainer = messagesEndRef.current?.closest('[data-scroll-container="chat"]');
    if (!scrollContainer) return;

    const handleScroll = () => {
      const distanceFromBottom =
        scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      shouldAutoScrollRef.current = distanceFromBottom < 120;
    };

    handleScroll();
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Scroll to bottom when messages change, but avoid fighting user scroll
  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: isLoading ? "auto" : "smooth" });
  }, [messages, isLoading]);

  // Empty state for chat
  if (messages.length === 0 && !error && !isLoading) {
    return (
      <div className="text-center text-slate-500 py-10 px-4">
        <h2 className="text-xl font-medium text-slate-800 mb-4">Dobrodošli na Alimentacija.info</h2>
        <div className="space-y-3 max-w-lg mx-auto text-sm leading-relaxed">
          <p>Postavite pitanje kroz chat i odmah dobijte odgovor sa informacijama koji vam može pomoći u daljnjem usmjeravanju!</p>
          <div className="bg-blue-50 text-blue-800 p-4 rounded-lg text-left mt-6">
            <p className="font-medium mb-1">Napomena o odgovornosti:</p>
            <p className="opacity-90">Ova usluga pruža opće pravne informacije i ne predstavlja pravni savjet. Ne postoji odvjetničko-klijentski odnos.</p>
          </div>
          <p className="text-slate-400 text-xs mt-4">Asistent može pogriješiti. Uvijek provjerite važne informacije.</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="max-w-4xl mx-auto p-4 md:p-5 w-full" 
      style={{ 
        fontSize: `${textSize}px`,
        paddingBottom: '200px' // Added huge padding to clear the floating input
      }}
      role="log"
      aria-label="Povijest razgovora"
      aria-live="polite"
    >
      <div className="space-y-6">
        {/* Render chat messages */}
        {messages.map((msg, index) => {
          const messageKey = msg.timestamp || `msg-${index}`;
          return <MessageBubble key={messageKey} msg={msg} index={index} />;
        })}

        {/* Loading indicator (Typing Bubble) */}
        {isLoading && <TypingBubble />}

        {/* Error display */}
        {error && (
          <div className="flex justify-center animate-in fade-in slide-in-from-bottom-2">
            <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg border border-red-100 text-sm shadow-sm">
              {error}
            </div>
          </div>
        )}
        
        {/* Scroll anchor */}
        <div ref={messagesEndRef} className="h-1" />
      </div>
    </div>
  );
}

export default MessageList;
