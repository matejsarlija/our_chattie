import { Link } from 'react-router-dom';
import MobileHeaderDropdown from '../MobileHeaderDropdown';
import { useChat } from '../../contexts/ChatContext';

export default function ChatHeader({ 
  mode = 'chat', 
  onModeToggle
}) {
  const { textSize, setTextSize } = useChat();
  return (
    <div className="bg-white p-4 shadow-sm border-b border-slate-200">
      <div className="max-w-6xl mx-auto flex justify-between items-center">
        <div className="flex items-center gap-4">
          {/* Logo */}
          <h1 className="text-slate-800 text-xl font-medium font-main">
            <Link to="/">
              Pravni Asistent
            </Link>
          </h1>

          {/* Mode toggle button - only show if onModeToggle provided */}
          {onModeToggle && (
            <button
              onClick={onModeToggle}
              className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center gap-2"
              title={mode === 'chat' ? 'Prebaci na Canvas' : 'Prebaci na Chat'}
            >
              {mode === 'chat' ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  Canvas
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  Chat
                </>
              )}
            </button>
          )}
        </div>

        {/* Desktop navigation links - shown only on large screens */}
        <div className="hidden lg:flex items-center gap-6">
          {/* Text size controls */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Tekst:</span>
            <button
              onClick={() => setTextSize(16)}
              className={`px-2 py-1 text-sm rounded ${textSize === 16 ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-800'} hover:bg-slate-200`}
            >
              A
            </button>
            <button
              onClick={() => setTextSize(18)}
              className={`px-2 py-1 text-sm rounded ${textSize === 18 ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-800'} hover:bg-slate-200`}
            >
              A+
            </button>
          </div>

          <div className="h-4 w-px bg-slate-200"></div>

          <Link to="/pravila-privatnosti" className="text-slate-600 hover:text-slate-800 transition-colors">
            Pravila privatnosti
          </Link>
          <Link to="/o-nama" className="text-slate-600 hover:text-slate-800 transition-colors">
            O nama
          </Link>
        </div>

        {/* Mobile hamburger menu - hidden on large screens */}
        <div className="lg:hidden ml-auto">
          <MobileHeaderDropdown />
        </div>
      </div>
    </div>
  );
}