import React from 'react';

/**
 * A typing indicator bubble that shows three bouncing dots.
 * Used to indicate that the AI is generating a response.
 */
export default function TypingBubble() {
  return (
    <div className="flex justify-start animate-in fade-in duration-300">
      <div className="max-w-xs sm:max-w-md md:max-w-2xl p-4 rounded-2xl rounded-tl-none shadow-sm bg-white ring-1 ring-slate-200/50">
        <div className="flex space-x-1.5 items-center h-6 px-1">
          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
        </div>
      </div>
    </div>
  );
}
