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
              content: "Ti si prijateljski pravni asistent za starije korisnike na hrvatskom jeziku. Koristi jednostavan jezik, kratke rečenice i jasna objašnjenja. Uživaj!"
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
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-600 p-4 flex justify-between items-center">
        <h1 className="text-white text-dynamic font-bold">Ask Me Anything!</h1>
        <div className="flex gap-4 items-center">
  <button
    onClick={() => setTextSize(prev => prev === 16 ? 20 : 16)}
    className="text-white bg-blue-700 px-4 py-2 rounded-lg hover:bg-blue-800 transition-colors"
  >
    {textSize === 16 ? 'A+ Text Size' : 'A- Text Size'}
  </button>
  <button 
    onClick={() => {
      localStorage.removeItem('chatMessages');
      setMessages([]);
    }}
    className="text-white bg-orange-600 px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors"
  >
    Clear History
  </button>
  <button className="text-white bg-red-600 px-4 py-2 rounded-lg hover:bg-red-700 transition-colors">
    Exit
  </button>
</div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-3xl p-4 rounded-lg ${
                msg.isUser 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-white border-2 border-gray-200'
              } text-dynamic transition-all`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white p-4 rounded-lg border-2 border-gray-200 flex items-center gap-2">
              <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
              <span>Thinking...</span>
            </div>
          </div>
        )}
        {error && (
          <div className="bg-red-100 p-4 rounded-lg text-red-700 flex justify-between items-center">
            <span>⚠️ {error}</span>
            <button 
              onClick={() => setError('')}
              className="text-red-700 hover:text-red-900"
            >
              ×
            </button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t-2 p-4 bg-white">
        <div className="flex gap-4">
          <input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type your message here..."
            className="flex-1 p-4 border-2 rounded-lg text-dynamic focus:outline-none focus:border-blue-500"
            disabled={isLoading}
          />
          <button
            onClick={isLoading ? stopGeneration : handleSend}
            className={`${
              isLoading 
                ? 'bg-red-600 hover:bg-red-700' 
                : 'bg-blue-600 hover:bg-blue-700'
            } text-white p-4 rounded-lg transition-colors min-w-[120px]`}
          >
            {isLoading ? 'Stop ■' : 'Send ➔'}
          </button>
        </div>
        
        {/* Quick Actions */}
        <div className="flex gap-4 mt-4 flex-wrap">
          {['How to send email?', 'Help with video calls', 'Save a document'].map((text) => (
            <button
              key={text}
              onClick={() => setInputText(text)}
              className="bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200 text-lg transition-colors"
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}