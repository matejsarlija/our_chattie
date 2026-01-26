import { useFileUpload } from "../../hooks/useFileUpload";
import { useChat } from "../../contexts/ChatContext";

export default function ChatInput({
    inputText,
    setInputText,
    onSend,
    selectedFile: externalSelectedFile,
    onFileSelect,
    suggestionButtons = true,
}) {
    const { isLoading } = useChat();
    const {
        selectedFile,
        handleFileSelect,
        removeFile,
        triggerFileInput,
        fileInputRef,
    } = useFileUpload();

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

        // Get new height (with a max of 150px)
        const newHeight = Math.min(textarea.scrollHeight, 150);
        textarea.style.height = `${newHeight}px`;
    };

    const handleSuggestionClick = (text) => {
        setInputText(text);
        // Focus the input field after setting the text
        document.querySelector("textarea")?.focus();
    };

    const handleKeyPress = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
        }
    };

    // Suggestion buttons for chat mode
    const suggestions = [
        "Nisam u stanju otplatiti ratu kredita, što da radim?",
        "Koji zakon pokriva sljedeći dopis -",
        "Treba mi predložak za žalbu ...",
    ];

    return (
        <div className="border-t border-slate-200 bg-white py-4 md:py-5">
            <div className="max-w-4xl mx-auto px-4 md:px-5 w-full">
                {/* File attachment preview */}
                {currentFile && (
                    <div className="mb-2 p-2 bg-blue-50 rounded-lg flex items-center justify-between">
                        <div className="flex items-center text-sm text-blue-600">
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
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                            </svg>
                            <span className="truncate max-w-[200px]">
                                {currentFile.name}
                            </span>
                        </div>
                        <button
                            onClick={handleRemoveFile}
                            className="text-slate-500 hover:text-slate-700"
                        >
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
                            >
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
                        onChange={(e) => {
                            handleFileSelect(e);
                            onFileSelect?.(e.target.files[0]);
                        }}
                        accept=".pdf,image/jpeg,image/png,image/gif,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                        className="hidden"
                    />

                    {/* Textarea with auto-resize */}
                    <textarea
                        value={inputText}
                        onChange={adjustTextareaHeight}
                        onKeyPress={handleKeyPress}
                        placeholder="Postavite svoje pravno pitanje..."
                        className="flex-1 p-3 md:p-3.5 border-2 border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 bg-white resize-none"
                        style={{
                            height: "auto",
                            minHeight: "50px",
                            paddingLeft: "1.55rem", // Make room for the button
                            paddingBottom: "0.5rem", // Add space at bottom for the button row
                        }}
                        disabled={isLoading}
                        aria-label="Polje za unos pravnog pitanja"
                    />

                    {/* Attachment button - positioned absolutely at bottom left */}
                    <div className="absolute bottom-2 left-2 hidden md:flex items-center">
                        <button
                            onClick={() => {
                                triggerFileInput();
                            }}
                            disabled={isLoading || !!currentFile}
                            className={`text-slate-400 hover:text-slate-600 ${isLoading || !!currentFile ? "opacity-50 cursor-not-allowed" : ""}`}
                            aria-label="Dodaj privitak"
                            title="Dodaj privitak"
                        >
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
                            >
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                            </svg>
                        </button>
                    </div>

                    {/* Send button */}
                    <button
                        onClick={isLoading ? () => {} : onSend}
                        className={`ml-2 h-10 w-12 flex items-center justify-center rounded-md ${isLoading ? "bg-red-500 hover:bg-red-600" : "bg-blue-600 hover:bg-blue-700"} text-white`}
                        aria-label={isLoading ? "Zaustavi" : "Pošalji"}
                    >
                        {isLoading ? (
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="white"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <rect
                                    x="4"
                                    y="4"
                                    width="16"
                                    height="16"
                                    rx="2"
                                    ry="2"
                                />
                            </svg>
                        ) : (
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
                            >
                                <line x1="5" y1="12" x2="19" y2="12" />
                                <polyline points="12 5 19 12 12 19" />
                            </svg>
                        )}
                    </button>
                </div>

                {/* File upload hint */}
                <div className="mt-2 flex justify-center">
                    <div className="text-xs text-slate-500 flex items-center">
                        <span>
                            Možete priložiti PDF ili sliku (max.
                            <span className="relative">
                                <label
                                    htmlFor="upgrade-toggle"
                                    className="text-indigo-500 font-medium border-b border-dotted border-indigo-300 cursor-pointer active:bg-indigo-100 rounded px-0.5"
                                >
                                    2MB
                                </label>
                                <input
                                    type="checkbox"
                                    id="upgrade-toggle"
                                    className="hidden peer"
                                />

                                {/* Popup only shows when checkbox is checked (clicked) */}
                                <span className="hidden peer-checked:block absolute left-1/2 bottom-full transform -translate-x-1/2 -translate-y-1 w-40 bg-white shadow-lg rounded-md p-2 text-xs border border-slate-200 z-10 transition duration-800 hover:scale-110 hover:box-shadow-lg">
                                    <p className="font-medium text-slate-800">
                                        Povećajte na 15MB
                                    </p>
                                    <p className="text-slate-600 text-xs">
                                        Nadogradite za veći limit
                                    </p>
                                    <a
                                        href="mailto:admin@alimentacija.info?subject=Želim omogućen upload većih dokumenata"
                                        className="mt-1 block text-center bg-indigo-600 text-white rounded py-1 text-xs"
                                    >
                                        Kontaktirajte nas
                                    </a>
                                    <span className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/2 rotate-45 w-2 h-2 bg-white border-r border-b border-slate-200"></span>
                                    <label
                                        htmlFor="upgrade-toggle"
                                        className="absolute top-1 right-1 text-slate-500 cursor-pointer"
                                    >
                                        ×
                                    </label>
                                </span>
                            </span>
                            )
                        </span>
                    </div>
                </div>

                {/* Suggestion buttons */}
                {suggestionButtons && (
                    <div className="hidden md:flex gap-2 md:gap-3 mt-3 md:mt-4 flex-wrap">
                        {suggestions.map((text) => (
                            <button
                                key={text}
                                onClick={() => handleSuggestionClick(text)}
                                className="text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded-md hover:bg-blue-100 transition-colors"
                            >
                                {text}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
