import React, { memo } from 'react';

/**
 * ScrollToBottomButton – a floating ↓ button that appears when the
 * user has scrolled up in the chat and there are new messages below.
 *
 * Props:
 *   onClick   – called when the button is clicked
 *   visible   – whether to show the button
 */
const ScrollToBottomButton = memo(({ onClick, visible }) => {
    return (
        <button
            onClick={onClick}
            aria-label="Idi na kraj razgovora"
            className={[
                // Layout & shape (positioning is handled by parent overlay container)
                'flex items-center gap-1.5 px-3 py-1.5',
                'rounded-full shadow-lg border border-slate-200',
                // Colours
                'bg-white text-slate-600 text-xs font-medium',
                // Hover
                'hover:bg-slate-50 hover:shadow-xl hover:text-slate-900',
                'transition-all duration-200',
                // Visibility transition
                visible
                    ? 'opacity-100 translate-y-0 pointer-events-auto'
                    : 'opacity-0 translate-y-2 pointer-events-none',
            ].join(' ')}
        >
            {/* Down arrow icon */}
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            Novi odgovor
        </button>
    );
});

ScrollToBottomButton.displayName = 'ScrollToBottomButton';
export default ScrollToBottomButton;
