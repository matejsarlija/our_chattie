import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useOptionalAuth } from '../contexts/AuthContext';

export default function MobileHeaderDropdown({ onOpenNewAnalysis }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const auth = useOptionalAuth();
  const isAuthed = Boolean(auth?.user);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="lg:hidden relative" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        className="p-2 rounded-md hover:bg-[var(--surface-muted)] focus:outline-none"
        aria-label="Menu"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-muted)]">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg z-50">
          <div className="py-1">
            <Link
              to="/dashboard"
              className="block px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
              onClick={() => setIsOpen(false)}
            >
              Dashboard
            </Link>

            <button
              type="button"
              className="block w-full px-4 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
              onClick={() => {
                setIsOpen(false);
                onOpenNewAnalysis?.();
              }}
            >
              + Nova analiza
            </button>

            {auth && (isAuthed ? (
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
                onClick={async () => {
                  setIsOpen(false);
                  await auth.signOut();
                }}
              >
                Odjava
              </button>
            ) : (
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
                onClick={() => {
                  setIsOpen(false);
                  auth.openAuthModal();
                }}
              >
                Prijava
              </button>
            ))}

            <Link
              to="/pravila-privatnosti"
              className="block px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
              onClick={() => setIsOpen(false)}
            >
              Pravila privatnosti
            </Link>
            <Link
              to="/o-nama"
              className="block px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)]"
              onClick={() => setIsOpen(false)}
            >
              O nama
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
