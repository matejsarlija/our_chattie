import { useState, useRef, useEffect } from 'react';

export default function SimpleChat() {
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('chatMessages');
    return saved ? JSON.parse(saved) : [];
  });
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [textSize, setTextSize] = useState(16); // Base size in px
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);
  const controllerRef = useRef(null);

  // Save messages to localStorage
  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(messages));
  }, [messages]);

  // Update text size CSS variable
  useEffect(() => {
    document.documentElement.style.setProperty('--text-size', `${textSize}px`);
  }, [textSize]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const handleSend = async () => {
    if (!inputText.trim() || isLoading) return;

    // Add user message
    const userMessage = { text: inputText, isUser: true };
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);
    setError('');

    try {
      // Add empty AI message placeholder
      const aiMessage = { text: '', isUser: false };
      setMessages(prev => [...prev, aiMessage]);

      controllerRef.current = new AbortController();
      
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: "You are a helpful legal assistant that excels at being factual. You frequently work with the elderly in need of free legal advice. You only provide answers in Croatian."
            },
            { role: "user", content: inputText }
          ]
        }),
        signal: controllerRef.current.signal
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line.replace('data: ', ''));
            
            if (data.content) {
              fullResponse += data.content;
              setMessages(prev => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1].text = fullResponse;
                return newMessages;
              });
            }
          } catch (e) {
            console.error('Parsing error:', e);
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError('Connection failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
      controllerRef.current = null;
    }
  };

  const stopGeneration = () => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* White Header */}
      <div className="bg-white p-4 shadow-sm border-b border-slate-200">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <h1 className="text-slate-800 text-xl font-medium font-main">
            Pravni Asistent
          </h1>
          <div className="flex gap-3">
            <button
              onClick={() => setTextSize(prev => prev === 16 ? 20 : 16)}
              className="text-slate-800 bg-slate-100 px-3.5 py-2 rounded-lg hover:bg-slate-50 transition-colors border border-slate-300 hover:border-slate-400"
            >
              {textSize === 16 ? 'A+' : 'A-'}
            </button>
            <button 
              onClick={() => {
                localStorage.removeItem('chatMessages');
                setMessages([]);
              }}
              className="text-slate-800 bg-slate-100 px-3.5 py-2 rounded-lg hover:bg-slate-50 transition-colors border border-slate-300 hover:border-slate-400"
            >
              Očisti razgovor
            </button>
          </div>
        </div>
      </div>
  
      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-5 max-w-6xl mx-auto w-full">
        <div className="space-y-4">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-2xl p-4 rounded-xl ${
                  msg.isUser 
                    ? 'bg-blue-600 text-white shadow-sm' 
                    : 'bg-white shadow-sm border border-slate-100'
                } text-dynamic transition-all`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {/* Loading and error states remain similar */}
        </div>
        <div ref={messagesEndRef} />
      </div>
  
      {/* Input Area */}
      <div className="border-t border-slate-200 bg-white py-5">
        <div className="max-w-6xl mx-auto px-5">
          <div className="flex gap-3">
            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Postavite svoje pravno pitanje..."
              className="flex-1 p-3.5 border-2 border-slate-200 rounded-lg text-dynamic focus:outline-none focus:border-blue-500 bg-white"
              disabled={isLoading}
            />
            <button
              onClick={isLoading ? stopGeneration : handleSend}
              className={`px-5 py-3.5 rounded-lg text-white font-medium transition-colors ${
                isLoading 
                  ? 'bg-red-500 hover:bg-red-600' 
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isLoading ? 'Zaustavi' : 'Pošalji →'}
            </button>
          </div>
          
          {/* Quick Actions */}
          <div className="flex gap-3 mt-4 flex-wrap">
            {['Pregled ugovora', 'Pomoć s dokumentom', 'Pravni savjet'].map((text) => (
              <button
                key={text}
                onClick={() => setInputText(text)}
                className="text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded-md hover:bg-blue-100 transition-colors"
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}