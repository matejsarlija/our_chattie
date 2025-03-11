import ReactMarkdown from 'react-markdown';
import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function AltChat() {
    // [All the existing state variables and functions remain the same]
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

    // Load AdSense script and initialize ads
    useEffect(() => {
        try {
            if (window.adsbygoogle && !window.adsbygoogle.loaded) {
                window.adsbygoogle = window.adsbygoogle || [];
                window.adsbygoogle.push({});
            }
        } catch (e) {
            console.error('AdSense initialization error:', e);
        }
    }, []); // Empty dependency array ensures it runs once on mount

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
        document.querySelector('textarea')?.focus();
    };

    const adjustTextareaHeight = (e) => {
        const textarea = e.target;
        setInputText(textarea.value);

        // Reset height to calculate properly
        textarea.style.height = 'auto';

        // Get new height (with a max of 150px)
        const newHeight = Math.min(textarea.scrollHeight, 150);
        textarea.style.height = `${newHeight}px`;
    };

    return (
        <div className="flex flex-col h-screen bg-slate-50">
            {/* White Header */}
            <div className="bg-white p-4 shadow-sm border-b border-slate-200">
                <div className="max-w-6xl mx-auto flex justify-between items-center">
                    <h1 className="text-slate-800 text-xl font-medium font-main">
                        <Link to="/">
                        Pravni Asistent
                        </Link>
                    </h1>
                    <div className="flex gap-6">
                        <Link to="/pravila-privatnosti" className="text-slate-600 hover:text-slate-800 transition-colors">
                            Pravila privatnosti
                        </Link>
                        <Link to="/o-nama" className="text-slate-600 hover:text-slate-800 transition-colors">
                            O nama
                        </Link>
                    </div>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Left Ad Column - Hidden on mobile */}
                <div className="hidden md:block w-1/6 lg:w-1/5 bg-white border-r border-slate-200 p-4">
                    <div className="sticky top-4">
                        {/* Google Adsense Left Column Code */}
                        <div className="ad-container-left h-96 lg:h-[600px] bg-slate-100 rounded-lg">
                            <ins className="adsbygoogle"
                                style={{ display: "block" }}
                                data-ad-client="ca-pub-4611047163958988"
                                data-ad-slot="6802702755"
                                data-ad-format="auto"
                                data-full-width-responsive="true"></ins>
                        </div>
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

                    {/* Input Area with Button Outside Textarea */}
                    <div className="border-t border-slate-200 bg-white py-4 md:py-5">
                        <div className="max-w-4xl mx-auto px-4 md:px-5 w-full">
                            <div className="relative flex items-end"> {/* Added items-end to align items to bottom */}
                                <textarea
                                    value={inputText}
                                    onChange={adjustTextareaHeight}
                                    onKeyPress={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSend();
                                        }
                                    }}
                                    placeholder="Postavite svoje pravno pitanje..."
                                    className="flex-1 p-3 md:p-3.5 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 bg-white resize-none"
                                    style={{ height: 'auto', minHeight: '50px' }}
                                    disabled={isLoading}
                                ></textarea>

                                {/* Button positioned outside textarea, aligned to bottom */}
                                <button
                                    onClick={isLoading ? stopGeneration : handleSend}
                                    className={`ml-2 h-10 w-12 flex items-center justify-center rounded-md ${isLoading ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'
                                        } text-white`}
                                    aria-label={isLoading ? "Zaustavi" : "Pošalji"}
                                >
                                    {isLoading ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="5" y1="12" x2="19" y2="12" />
                                            <polyline points="12 5 19 12 12 19" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Footer - New addition */}
                    <footer className="bg-white p-4 border-t border-slate-200 mt-auto">
                        <div className="max-w-4xl mx-auto text-center text-slate-600 text-sm">
                            <p>© {new Date().getFullYear()} Alimentacija.info | Pravni Asistent</p>
                            <p className="mt-1">
                                Sve informacije pružene putem ove usluge su informativne prirode i ne predstavljaju pravni savjet.
                            </p>
                        </div>
                    </footer>
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