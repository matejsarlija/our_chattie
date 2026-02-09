import { useRef } from "react";
import { useFileUpload } from "../../hooks/useFileUpload";
import { useChat } from "../../contexts/ChatContext";

export default function ChatInput({
    inputText,
    setInputText,
    onSend,
    onStop = () => {},
    selectedFile: externalSelectedFile,
    onFileSelect,
    suggestionButtons = true,
}) {
    const { isLoading, error } = useChat();
    const {
        selectedFile,
        handleFileSelect,
        removeFile,
        triggerFileInput,
        fileInputRef,
    } = useFileUpload();
    const textareaRef = useRef(null);

    // Use external file if provided, otherwise use internal state
    const currentFile = externalSelectedFile || selectedFile;

    const handleRemoveFile = () => {
        removeFile();
        onFileSelect?.(null);
    };

    const adjustTextareaHeight = (e) => {
        const textarea = e.target;
        setInputText(textarea.value);

        // Reset height to calculate properly
        textarea.style.height = "auto";

        // Get new height (min 24px, max 200px)
        const newHeight = Math.min(textarea.scrollHeight, 200);
        textarea.style.height = `${newHeight}px`;
    };

    const handleSuggestionClick = (text) => {
        setInputText(text);
        // Focus the input field after setting the text
        textareaRef.current?.focus();
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
        }
    };

    // Suggestion buttons for chat mode
    const suggestions = [
        "Nisam u stanju otplatiti ratu kredita",
        "Koji zakon pokriva sljedeći dopis...",
        "Treba mi predložak za žalbu...",
    ];

    return (
        <div className="fixed bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-white via-white to-transparent pointer-events-none z-10">
            <div className="max-w-4xl mx-auto w-full pointer-events-auto">
                {/* File attachment preview */}
                {currentFile && (
                    <div className="mb-3 mx-1 inline-flex items-center gap-2 px-3 py-2 bg-white rounded-xl shadow-sm border border-slate-200 animate-in slide-in-from-bottom-2">
                        <div className="flex items-center text-sm text-blue-600 font-medium">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="mr-2"
                            >
                                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                                <polyline points="14 2 14 8 20 8" />
                            </svg>
                            <span className="truncate max-w-[200px]">
                                {currentFile.name}
                            </span>
                        </div>
                        <button
                            onClick={handleRemoveFile}
                            className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-100 rounded-full transition-colors"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                )}

                {/* The "Island" Input Container */}
                <div className={`relative flex items-end bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 transition-shadow duration-200 ${isLoading ? 'ring-1 ring-slate-100' : 'focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-400'}`}>
                    
                    {/* Hidden file input */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={(e) => {
                            handleFileSelect(e);
                            onFileSelect?.(e.target.files[0]);
                        }}
                        accept=".pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                        className="hidden"
                    />

                    {/* Attachment Button */}
                    <button
                        onClick={triggerFileInput}
                        disabled={isLoading || !!currentFile}
                        className={`p-3.5 mb-0.5 text-slate-400 hover:text-slate-600 transition-colors ${isLoading || !!currentFile ? "opacity-50 cursor-not-allowed" : ""}`}
                        aria-label="Dodaj privitak"
                        title="Dodaj privitak"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                        </svg>
                    </button>

                    {/* Textarea */}
                    <textarea
                        ref={textareaRef}
                        value={inputText}
                        onChange={adjustTextareaHeight}
                        onKeyDown={handleKeyDown}
                        placeholder="Postavite svoje pravno pitanje..."
                        className="flex-1 max-h-[200px] py-3.5 bg-transparent border-none focus:ring-0 text-slate-800 placeholder:text-slate-400 resize-none leading-relaxed"
                        style={{
                            height: "52px",
                            minHeight: "52px",
                        }}
                        disabled={isLoading}
                        aria-label="Polje za unos pravnog pitanja"
                    />

                    {/* Action Button (Send or Stop) */}
                    <div className="p-2">
                        <button
                            onClick={isLoading ? onStop : onSend}
                            disabled={!inputText.trim() && !currentFile && !isLoading}
                            className={`h-9 w-9 flex items-center justify-center rounded-xl transition-all duration-200 ${
                                isLoading 
                                    ? "bg-slate-100 text-slate-600 hover:bg-slate-200" 
                                    : inputText.trim() || currentFile
                                        ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                                        : "bg-slate-100 text-slate-300 cursor-not-allowed"
                            }`}
                            aria-label={isLoading ? "Zaustavi" : "Pošalji"}
                        >
                            {isLoading ? (
                                /* Stop Icon (Square) */
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="2" y="2" width="20" height="20" rx="4" />
                                </svg>
                            ) : (
                                /* Send Icon (Arrow) */
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ml-0.5">
                                    <line x1="12" y1="19" x2="12" y2="5" />
                                    <polyline points="5 12 12 5 19 12" />
                                </svg>
                            )}
                        </button>
                    </div>
                </div>

                {/* Suggestion buttons (Moved Below) */}
                {suggestionButtons && !inputText && !isLoading && (
                    <div className="mt-3 hidden md:flex gap-2 overflow-x-auto pb-1 scrollbar-hide justify-center md:justify-start">
                        {suggestions.map((text) => (
                            <button
                                key={text}
                                onClick={() => handleSuggestionClick(text)}
                                className="whitespace-nowrap text-xs font-medium text-slate-500 bg-white/80 backdrop-blur-sm border border-slate-200 px-3 py-1.5 rounded-full hover:border-slate-300 hover:shadow-sm hover:text-slate-700 hover:bg-white transition-all"
                            >
                                {text}
                            </button>
                        ))}
                    </div>
                )}

                {/* Error Display Area */}
                {error && (
                    <div className="mt-2 mx-1 p-2 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 flex items-start animate-in slide-in-from-top-2">
                         <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 mr-2 flex-shrink-0">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <span>{error}</span>
                    </div>
                )}

                {/* File upload hint */}
                <div className="mt-2 text-center">
                    <span className="text-[10px] text-slate-400">
                        Pritisnite Enter za slanje &bull; Shift + Enter za novi red
                    </span>
                </div>

                {/* Main Screen Footer */}
                <div className="mt-4 pb-2 text-center border-t border-slate-100 pt-3">
                    <p className="text-[10px] text-slate-400 font-medium">
                        &copy; 2026 Alimentacija.info
                    </p>
                    <p className="text-[9px] text-slate-300 mt-0.5">
                        Sve informacije pružene putem ove usluge su informativne prirode i ne predstavljaju pravni savjet.
                    </p>
                </div>
            </div>
        </div>
    );
}
