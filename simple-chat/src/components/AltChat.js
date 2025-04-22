import ReactMarkdown from 'react-markdown';
import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import WelcomeModal from './WelcomeModal';
import { useFirstVisit } from '../hooks/useFirstVisit';

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
    const [selectedFile, setSelectedFile] = useState(null);
    const messagesEndRef = useRef(null);
    const controllerRef = useRef(null);
    const fileInputRef = useRef(null);

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

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            // Check file type
            const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
            if (!allowedTypes.includes(file.type)) {
                setError('Nepodržani format datoteke. Dozvoljeni su samo PDF, JPEG i PNG.');
                e.target.value = '';
                return;
            }

            // Check file size (2MB limit)
            if (file.size > 2 * 1024 * 1024) {
                setError('Datoteka je prevelika. Maksimalna veličina je 2MB.');
                e.target.value = '';
                return;
            }

            setSelectedFile(file);
            setError('');
        }
    };

    const handleSend = async () => {
        if ((!inputText.trim() && !selectedFile) || isLoading) return;

        const userMessage = {
            text: inputText,
            isUser: true,
            timestamp: new Date().toISOString(),
            hasAttachment: !!selectedFile,
            attachmentName: selectedFile ? selectedFile.name : null
        };

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
            })).filter(msg => msg.content.trim() !== '' || msg.hasAttachment);

            const API_URL = process.env.REACT_APP_API_URL || '/api/chat';

            // Use FormData for file uploads
            const formData = new FormData();

            // Add the messages as JSON string
            formData.append('messages', JSON.stringify(chatMessages));

            // Add the file if one is selected
            if (selectedFile) {
                formData.append('file', selectedFile);
            }

            const response = await fetch(API_URL, {
                method: 'POST',
                body: formData,
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
            setSelectedFile(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
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

    const handleRemoveFile = () => {
        setSelectedFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
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

    const { isFirstVisit, loading } = useFirstVisit();
    const [showWelcomeModal, setShowWelcomeModal] = useState(false);

    // Show the modal when we determine it's a first visit
    useEffect(() => {
        if (!loading && isFirstVisit) {
            setShowWelcomeModal(true);
        }
    }, [isFirstVisit, loading]);

    const closeWelcomeModal = () => {
        setShowWelcomeModal(false);
    };

    const triggerFileInput = () => {
        fileInputRef.current?.click();
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
                                    <h2 className="text-xl mb-3">Dobrodošli na Alimentacija.info</h2>
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
                                                <div>
                                                    {msg.isUser ? (
                                                        <>
                                                            <div>{msg.text}</div>
                                                            {msg.hasAttachment && (
                                                                <div className="mt-2 flex items-center text-white text-sm">
                                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                                                                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                                                                    </svg>
                                                                    <span className="truncate max-w-[200px]">{msg.attachmentName}</span>
                                                                </div>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <div className="prose prose-slate max-w-none">
                                                            <ReactMarkdown>{msg.text}</ReactMarkdown>
                                                        </div>
                                                    )}
                                                </div>
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

                    {/* Input Area with Button and File Attachment */}
                    <div className="border-t border-slate-200 bg-white py-4 md:py-5">
                        <div className="max-w-4xl mx-auto px-4 md:px-5 w-full">
                            {/* File attachment preview */}
                            {selectedFile && (
                                <div className="mb-2 p-2 bg-blue-50 rounded-lg flex items-center justify-between">
                                    <div className="flex items-center text-sm text-blue-600">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                                        </svg>
                                        <span className="truncate max-w-[200px]">{selectedFile.name}</span>
                                    </div>
                                    <button
                                        onClick={handleRemoveFile}
                                        className="text-slate-500 hover:text-slate-700"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="18" y1="6" x2="6" y2="18" />
                                            <line x1="6" y1="6" x2="18" y2="18" />
                                        </svg>
                                    </button>
                                </div>
                            )}

                            <div className="relative flex items-end">
                                {/* Hidden file input */}
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileSelect}
                                    accept=".pdf,image/jpeg,image/png,image/gif"
                                    className="hidden"
                                />

                                {/* Textarea with bottom padding for the button */}
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
                                    style={{
                                        height: 'auto',
                                        minHeight: '50px',
                                        paddingLeft: '1.55rem', // Make room for the button
                                        paddingBottom: '0.5rem' // Add space at bottom for the button row
                                    }}
                                    disabled={isLoading}
                                ></textarea>

                                {/* Attachment button row - positioned absolutely at bottom */}
                                <div className="absolute bottom-2 left-2 hidden md:flex items-center">
                                    <button
                                        onClick={triggerFileInput}
                                        disabled={isLoading || !!selectedFile}
                                        className={`text-slate-400 hover:text-slate-600 ${(isLoading || !!selectedFile) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                                        </svg>
                                    </button>
                                </div>

                                {/* Send button */}
                                <button
                                    onClick={isLoading ? stopGeneration : handleSend}
                                    className={`ml-2 h-10 w-12 flex items-center justify-center rounded-md ${isLoading ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
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

                            {/* File upload hint */}
                            <div className="mt-2 text-xs text-slate-500 text-center">
                                Možete priložiti PDF ili sliku (max. 2MB)
                            </div>
                            <div className="hidden md:flex gap-2 md:gap-3 mt-3 md:mt-4 flex-wrap">
                                {['Nisam u stanju otplatiti ratu kredita, što da radim?', 'Koji zakon pokriva sljedeći dopis -', 'Supružnik ne plaća alimentaciju...'].map(text => (
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
                <div className="lg:hidden fixed bottom-60 right-4 z-10 flex flex-col gap-2">
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
                    <button
                        onClick={triggerFileInput}
                        disabled={isLoading || !!selectedFile}
                        className={`w-12 h-12 flex items-center justify-center rounded-full bg-white shadow-md border border-slate-200 text-slate-600 ${(isLoading || !!selectedFile) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                        </svg>
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
            <WelcomeModal
                isOpen={showWelcomeModal}
                onClose={closeWelcomeModal}
            />
        </div>
    );
}