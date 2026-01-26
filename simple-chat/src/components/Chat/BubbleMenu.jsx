import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useStreamingAPI } from '../../hooks/useStreamingAPI';

export default function BubbleMenuContent({ 
  editor, 
  selectedText, 
  onReplaceText,
  onClose,
  isMobile
}) {
  const [customPrompt, setCustomPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPresetButtons, setShowPresetButtons] = useState(true);
  const menuRef = useRef(null);
  
  const streamingAPI = useStreamingAPI();

  // Preset legal prompts for Croatian legal context
  const presetPrompts = [
    "Make this more formal for Croatian court",
    "Expand with legal precedents",
    "Add legal terminology",
    "Simplify this language",
    "Add supporting arguments",
    "Format as legal paragraph",
    "Format as legal citation"
  ];

  // Handle preset prompt selection
  const handlePresetClick = useCallback(async (prompt) => {
    if (!selectedText || isLoading) return;
    
    setIsLoading(true);
    setShowPresetButtons(false);
    setCustomPrompt(prompt);
    
    try {
      await streamingAPI.streamDocumentEdit(selectedText, prompt, {
        onContent: (content) => {
          // Replace selected text with streaming content
          if (editor && onReplaceText) {
            const { from, to } = editor.state.selection;
            editor.chain()
              .focus()
              .deleteRange({ from, to })
              .insertContent(content)
              .run();
            
            onReplaceText(content);
          }
        },
        onComplete: (response) => {
          setIsLoading(false);
          setTimeout(() => {
            onClose?.();
            setCustomPrompt('');
            setShowPresetButtons(true);
          }, 1000);
        },
        onError: (error) => {
          setIsLoading(false);
          console.error('BubbleMenu AI error:', error);
        }
      });
    } catch (error) {
      setIsLoading(false);
      console.error('BubbleMenu request failed:', error);
    }
  }, [selectedText, editor, onReplaceText, onClose, streamingAPI, isLoading]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        setCustomPrompt('');
        setShowPresetButtons(true);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const containerClasses = isMobile 
    ? "fixed top-5 left-4 right-4 z-50 bg-white rounded-lg shadow-lg border border-slate-200 p-4 max-w-md"
    : "bg-white rounded-lg shadow-lg border border-slate-200 p-4 w-80"; // Desktop uses relative styling as it's wrapped in BubbleMenu

  return (
    <div 
      ref={menuRef}
      className={containerClasses}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="space-y-3">
        <div className="text-sm font-medium text-slate-700 mb-2">
          Uredite označeni tekst
        </div>
        
        {showPresetButtons ? (
          <div className="grid grid-cols-2 gap-2 mb-3">
            {presetPrompts.map((prompt, index) => (
              <button
                key={index}
                onClick={() => handlePresetClick(prompt)}
                disabled={isLoading}
                className="text-left text-xs p-2 bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-3">
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Kako da uredim ovaj tekst?"
              className="w-full p-2 border border-slate-300 rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              disabled={isLoading}
              autoFocus
            />
          </div>
        )}

        <div className="flex gap-2">
          {showPresetButtons && (
            <button
              onClick={() => setShowPresetButtons(false)}
              className="text-xs p-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors"
            >
              Prilagođena naredba
            </button>
          )}
          
          <button
            onClick={() => {
              onClose?.();
              setCustomPrompt('');
              setShowPresetButtons(true);
            }}
            className="text-xs p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
          >
            Otkaži
          </button>
        </div>

        {isLoading && (
          <div className="text-xs text-slate-500 text-center mt-2">
            AI obrađuje...
          </div>
        )}
      </div>
    </div>
  );
}