import { useChat } from '../../contexts/ChatContext';

export default function MobileControls({ 
  onClearChat, 
  onFileUpload,
  selectedFile,
  mode = 'chat'
}) {
  const { textSize, setTextSize, isLoading } = useChat();
  const handleFileUpload = () => {
    // Trigger hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf,image/jpeg,image/png,image/gif,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';
    fileInput.onchange = (e) => onFileUpload?.(e.target.files[0]);
    fileInput.click();
  };

  return (
    <div className="lg:hidden fixed bottom-60 right-4 z-10 flex flex-col gap-2">
      {/* Clear chat button - only in chat mode */}
      {mode === 'chat' && (
        <button
          onClick={onClearChat}
          className="w-12 h-12 flex items-center justify-center rounded-full bg-white shadow-md border border-slate-200 text-slate-600"
          title="Očisti razgovor"
        >
          🗑️
        </button>
      )}

      {/* Text size toggle */}
      <button
        onClick={() => setTextSize(textSize === 16 ? 18 : 16)}
        className="w-12 h-12 flex items-center justify-center rounded-full bg-white shadow-md border border-slate-200 text-slate-600"
        title={textSize === 16 ? 'Povećaj tekst' : 'Smanji tekst'}
      >
        {textSize === 16 ? 'A+' : 'A'}
      </button>

      {/* File upload button */}
      <button
        onClick={handleFileUpload}
        disabled={isLoading || !!selectedFile}
        className={`w-12 h-12 flex items-center justify-center rounded-full bg-white shadow-md border border-slate-200 text-slate-600 ${(isLoading || !!selectedFile) ? 'opacity-50 cursor-not-allowed' : ''}`}
        title="Dodaj datoteku"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
        </svg>
      </button>

      {/* Mode-specific mobile controls */}
      {mode === 'canvas' && (
        <button
          className="w-12 h-12 flex items-center justify-center rounded-full bg-white shadow-md border border-slate-200 text-slate-600"
          title="Document Tools"
        >
          📄
        </button>
      )}
    </div>
  );
}