import ReactMarkdown from 'react-markdown';
import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function AltChat() {
    const [messages, setMessages] = useState(() => {
        try {
            const saved = localStorage.getItem('chatMessages');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('Failed to load messages from localStorage', error);
            return [];
        }
    });
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [textSize, setTextSize] = useState(() => {
        try {
            const savedSize = localStorage.getItem('textSize') ? parseInt(localStorage.getItem('textSize')) : 16;
            // Enforce the 16-18 range even for saved values
            return Math.min(Math.max(savedSize, 16), 18);
        } catch {
            return 16;
        }
    });
    const [error, setError] = useState('');
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const messagesEndRef = useRef(null);
    const controllerRef = useRef(null);
    
    // Save messages to localStorage when they change
    useEffect(() => {
        try {
            // Limit storage to last 50 messages to prevent quota issues
            const messagesToStore = messages.slice(-50);
            localStorage.setItem('chatMessages', JSON.stringify(messagesToStore));
        } catch (error) {
            console.error('Failed to save messages to localStorage', error);
            setError('Failed to save conversation history. Storage may be full.');
        }
    }, [messages]);
    
    // Save text size preference
    useEffect(() => {
        try {
            localStorage.setItem('textSize', textSize.toString());
        } catch (error) {
            console.error('Failed to save text size preference', error);
        }
    }, [textSize]);
    
    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages]);
    
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    
    const handleSend = async () => {
        if (!inputText.trim() || isLoading) return;
        
        const userMessage = { text: inputText, isUser: true, timestamp: new Date().toISOString() };
        setMessages(prev => [...prev, userMessage]);
        setInputText('');
        setIsLoading(true);
        setError('');
        
        try {
            const aiMessage = { text: '', isUser: false, timestamp: new Date().toISOString() };
            setMessages(prev => [...prev, aiMessage]);
            
            controllerRef.current = new AbortController();
            
            const chatMessages = [...messages, userMessage].map(msg => ({
                role: msg.isUser ? 'user' : 'assistant',
                content: msg.text
            })).filter(msg => msg.content.trim() !== '');

            const API_URL = process.env.REACT_APP_API_URL || '/api/chat';

            
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ messages: chatMessages }),
                signal: controllerRef.current.signal
            });
            
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedResponse = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n\n').filter(line => line.trim());
                
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    
                    try {
                        const data = JSON.parse(line.replace('data: ', ''));
                        if (data.content) {
                            // Fixed: Use a local variable instead of referring to the outer variable
                            const updatedResponse = accumulatedResponse + data.content;
                            accumulatedResponse = updatedResponse;
                            
                            setMessages(prev => {
                                const newMessages = [...prev];
                                newMessages[newMessages.length - 1].text = updatedResponse;
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
                setError(`Connection failed: ${err.message || 'Unknown error'}. Please try again.`);
                // Remove the incomplete AI message
                setMessages(prev => prev.slice(0, -1));
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
    
    const handleClearChat = () => {
        localStorage.removeItem('chatMessages');
        setMessages([]);
        setShowClearConfirm(false);
    };
    
    const handleSuggestionClick = (text) => {
        setInputText(text);
        // Focus the input field after setting the text
        document.querySelector('input[type="text"]')?.focus();
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
                    <Link to="/pravila-privatnosti" className="text-slate-600 hover:text-slate-800 transition-colors">
    Pravila privatnosti
</Link>
                    </div>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Left Ad Column - Hidden on mobile */}
                <div className="hidden md:block w-1/6 lg:w-1/5 bg-white border-r border-slate-200 p-4">
                    <div className="sticky top-4">
                        {/* Google Adsense Left Column Code */}
                        <div className="ad-container-left h-96 lg:h-[600px] bg-slate-100 rounded-lg"></div>
                    </div>
                </div>

                {/* Main Chat Area */}
                <div className="flex flex-col h-full flex-1">
                    <div className="flex-1 overflow-y-auto">
                        <div className="max-w-4xl mx-auto p-4 md:p-5 w-full" style={{ fontSize: `${textSize}px` }}>
                            {messages.length === 0 ? (
                                <div className="text-center text-slate-500 py-10">
                                    <h2 className="text-xl mb-3">Dobrodošli na Alimentacija.info | Pravni asistent</h2>
                                    <p>Postavite pitanje i dobijte opći pregled sa informacijama koji vam može pomoći u daljnjem usmjeravanju!</p>
                                    <p>Ova usluga pruža opće pravne informacije i ne predstavlja pravni savjet. Ne postoji odvjetničko-klijentski odnos između korisnika i pružatelja usluge.</p> 
                                    <p>Za konkretne pravne probleme i savjete prilagođene vašoj situaciji, obratite se kvalificiranom pravnom stručnjaku ili odvjetniku.</p>
                                    <p>Korištenjem ove usluge korisnik prihvaća navedene uvjete i razumije da pružene informacije nisu pravno obvezujuće.</p>
                                    <p>Asistent *može pogriješiti*. Provjerite važne informacije.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {messages.map((msg, index) => (
                                        <div
                                            key={index}
                                            className={msg.isUser ? 'flex justify-end' : 'flex justify-start'}
                                        >
                                            <div
                                                className={msg.isUser ?
                                                    'max-w-xs sm:max-w-md md:max-w-2xl p-3 md:p-4 rounded-xl bg-blue-600 text-white shadow-sm' :
                                                    'max-w-xs sm:max-w-md md:max-w-2xl p-3 md:p-4 rounded-xl bg-white shadow-sm border border-slate-100'
                                                }
                                            >
                                                {msg.isUser ? (
                                                    <div>{msg.text}</div>
                                                ) : (
                                                    <div className="prose prose-slate max-w-none">
                                                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {error && (
                                        <div className="bg-red-50 p-3 rounded-lg border border-red-100 text-red-600 text-center">
                                            {error}
                                        </div>
                                    )}
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                    </div>

                    {/* Input Area */}
                    <div className="border-t border-slate-200 bg-white py-4 md:py-5">
                        <div className="max-w-4xl mx-auto px-4 md:px-5 w-full">
                            <div className="flex gap-2 md:gap-3">
                                <input
                                    type="text"
                                    value={inputText}
                                    onChange={e => setInputText(e.target.value)}
                                    onKeyPress={e => e.key === 'Enter' && handleSend()}
                                    placeholder="Postavite svoje pravno pitanje..."
                                    className="flex-1 p-3 md:p-3.5 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 bg-white"
                                    disabled={isLoading}
                                />
                                <button
                                    onClick={isLoading ? stopGeneration : handleSend}
                                    className={isLoading ?
                                        'bg-red-500 hover:bg-red-600 text-white font-medium px-4 md:px-5 py-3 md:py-3.5 rounded-lg whitespace-nowrap' :
                                        'bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 md:px-5 py-3 md:py-3.5 rounded-lg whitespace-nowrap'
                                    }
                                >
                                    {isLoading ? 'Zaustavi' : 'Pošalji →'}
                                </button>
                            </div>
                            
                            <div className="flex gap-2 md:gap-3 mt-3 md:mt-4 flex-wrap">
                                {['Nisam u stanju otplatiti trenutnu ratu kredita, što da radim?', 'Koji zakon pokriva ovaj dopis', 'Supružnik ne plaća alimentaciju'].map(text => (
                                    <button
                                        key={text}
                                        onClick={() => handleSuggestionClick(text)}
                                        className="text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded-md hover:bg-blue-100 transition-colors"
                                    >
                                        {text}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Controls Column - Hidden on mobile and small screens */}
                <div className="hidden lg:block w-1/6 lg:w-1/5 bg-white border-l border-slate-200 p-4" style={{ overflowY: 'auto' }}>
                    <div className="sticky top-4 space-y-4">
                        {/* Text size toggle - Simplified */}
                        <div className="border border-slate-200 rounded-lg p-3 shadow-sm bg-white">
                            <p className="text-sm text-slate-600 mb-2">Veličina teksta</p>
                            <div className="flex items-center justify-center gap-4">
                                <button
                                    onClick={() => setTextSize(16)}
                                    className={`px-3 py-2 rounded-md ${textSize === 16 ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-800'} hover:bg-slate-200`}
                                >
                                    A
                                </button>
                                <button
                                    onClick={() => setTextSize(18)}
                                    className={`px-3 py-2 rounded-md ${textSize === 18 ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-800'} hover:bg-slate-200`}
                                >
                                    A+
                                </button>
                            </div>
                        </div>
                        
                        {/* Clear conversation button */}
                        <button
                            onClick={() => setShowClearConfirm(true)}
                            className="w-full text-slate-800 bg-slate-100 px-3.5 py-2 rounded-lg hover:bg-slate-200 transition-colors border border-slate-300"
                        >
                            Očisti razgovor
                        </button>

                        {/* Right Ad Container */}
                        <div className="mt-8">
                            <div className="ad-container-right h-[600px] bg-slate-100 rounded-lg"></div>
                        </div>
                    </div>
                </div>
                
                {/* Mobile Controls - Only shown on small screens */}
                <div className="lg:hidden fixed bottom-24 right-4 z-10 flex flex-col gap-2">
                    <button
                        onClick={() => setShowClearConfirm(true)}
                        className="w-12 h-12 flex items-center justify-center rounded-full bg-white shadow-md border border-slate-200 text-slate-600"
                    >
                        🗑️
                    </button>
                    <button
                        onClick={() => setTextSize(prev => prev === 16 ? 18 : 16)}
                        className="w-12 h-12 flex items-center justify-center rounded-full bg-white shadow-md border border-slate-200 text-slate-600"
                    >
                        {textSize === 16 ? 'A+' : 'A'}
                    </button>
                </div>
                
                {/* Confirmation Modal */}
                {showClearConfirm && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl">
                            <h3 className="text-lg font-medium mb-3">Očisti razgovor</h3>
                            <p className="text-slate-600 mb-4">Jeste li sigurni da želite očistiti cijeli razgovor?</p>
                            <div className="flex gap-3 justify-end">
                                <button 
                                    onClick={() => setShowClearConfirm(false)}
                                    className="px-4 py-2 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50"
                                >
                                    Odustani
                                </button>
                                <button 
                                    onClick={handleClearChat}
                                    className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                                >
                                    Očisti
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}