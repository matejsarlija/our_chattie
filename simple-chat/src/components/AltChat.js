import ReactMarkdown from 'react-markdown';
import { useState, useRef, useEffect } from 'react';

export default function SimpleChat() {
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('chatMessages');
    return saved ? JSON.parse(saved) : [];
  });
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [textSize, setTextSize] = useState(16);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);
  const controllerRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    document.getElementById('root').style.fontSize = `${textSize}px`; // Adjust as needed
  }, [textSize]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const handleSend = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage = { text: inputText, isUser: true };
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);
    setError('');

    try {
      const aiMessage = { text: '', isUser: false };
      setMessages(prev => [...prev, aiMessage]);

      controllerRef.current = new AbortController();

      const chatMessages = [...messages, userMessage].map(msg => ({
        role: msg.isUser ? 'user' : 'assistant',
        content: msg.text
      })).filter(msg => msg.content.trim() !== '');

      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: chatMessages }),
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
            } else if (data.error) {
              setError(data.error);
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
        <div className="flex gap-6">
          <a href="/o-nama" className="text-slate-600 hover:text-slate-800 transition-colors">
            O nama
          </a>
          <a href="/pravila-privatnosti" className="text-slate-600 hover:text-slate-800 transition-colors">
            Pravila privatnosti
          </a>
        </div>
      </div>
    </div>

    <div className="flex flex-1 overflow-hidden">
      {/* Left Ad Column */}
      <div className="w-1/6 bg-white border-r border-slate-200 p-4">
        <div className="sticky top-4">
          {/* Google Adsense Left Column Code */}
          <div className="ad-container-left h-[600px] bg-slate-100 rounded-lg"></div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 overflow-y-auto" style={{ width: '70%' }}>
        <div className="max-w-4xl mx-auto p-5 w-full">
          <div className="space-y-4">
                    {messages.map((msg, index) => (
                      <div
                        key={index}
                        className={msg.isUser ? 'flex justify-end' : 'flex justify-start'}
                      >
                        <div
                          className={msg.isUser ?
                            'max-w-2xl p-4 rounded-xl bg-blue-600 text-white shadow-sm text-dynamic' :
                            'max-w-2xl p-4 rounded-xl bg-white shadow-sm border border-slate-100 text-dynamic'
                          }
                        >
                          {msg.isUser ? (
                            <div>{msg.text}</div>
                          ) : (
                            <ReactMarkdown>{msg.text}</ReactMarkdown>
                          )}
                        </div>
                      </div>
                    ))}
                    {error && (
                      <div className="text-red-500 text-center">{error}</div>
                    )}
                  </div>
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-slate-200 bg-white py-5">
          <div className="max-w-4xl mx-auto px-5">
          <div className="flex gap-3">
            <input
              value={inputText}
              onInput={e => setInputText(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && handleSend()}
              placeholder="Postavite svoje pravno pitanje..."
              className="flex-1 p-3.5 border-2 border-slate-200 rounded-lg text-dynamic focus:outline-none focus:border-blue-500 bg-white"
              disabled={isLoading}
            />
            <button
              onClick={isLoading ? stopGeneration : handleSend}
              className={isLoading ?
                'bg-red-500 hover:bg-red-600 text-white font-medium px-5 py-3.5 rounded-lg' :
                'bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-3.5 rounded-lg'
              }
            >
              {isLoading ? 'Zaustavi' : 'Pošalji →'}
            </button>
          </div>
          <div className="flex gap-3 mt-4 flex-wrap">
            {['Pregled ugovora', 'Pomoć s dokumentom', 'Pravni savjet'].map(text => (
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

      {/* Right Controls Column */}
      <div className="w-1/6 bg-white border-l border-slate-200 p-4">
        <div className="sticky top-4 space-y-4">
          {/* Moved Controls */}
          <button
            onClick={() => setTextSize(prev => prev === 16 ? 20 : 16)}
            className="w-full text-slate-800 bg-slate-100 px-3.5 py-2 rounded-lg hover:bg-slate-50 transition-colors border border-slate-300 hover:border-slate-400"
          >
            {textSize === 16 ? 'A+' : 'A-'} Veličina teksta
          </button>
          <button 
            onClick={() => {
              localStorage.removeItem('chatMessages');
              setMessages([]);
            }}
            className="w-full text-slate-800 bg-slate-100 px-3.5 py-2 rounded-lg hover:bg-slate-50 transition-colors border border-slate-300 hover:border-slate-400"
          >
            Očisti razgovor
          </button>
          
          {/* Right Ad Container */}
          <div className="mt-8">
            <div className="ad-container-right h-[600px] bg-slate-100 rounded-lg"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
);
}