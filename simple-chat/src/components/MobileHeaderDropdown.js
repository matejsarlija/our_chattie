import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function MobileHeaderDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  // Close dropdown when clicking outside
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
      {/* Hamburger button */}
      <button
        onClick={toggleDropdown}
        className="p-2 rounded-md hover:bg-slate-100 focus:outline-none"
        aria-label="Menu"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg py-1 z-50 border border-slate-200">
          <div className="py-1">
            {/* Navigation links */}
            <Link
              to="/pravila-privatnosti"
              className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => setIsOpen(false)}
            >
              Pravila privatnosti
            </Link>
            <Link
              to="/o-nama"
              className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
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