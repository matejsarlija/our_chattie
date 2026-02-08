import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useStreamingAPI } from '../../hooks/useStreamingAPI';
import { buildTrackedChangesHtml } from '../../hooks/utils/diffUtils';

export default function BubbleMenuContent({ 
  editor, 
  selectedText, 
  selectionRange,
  onReplaceText,
  onClose,
  isMobile
}) {
  const [customPrompt, setCustomPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPresetButtons, setShowPresetButtons] = useState(true);
  const [previewState, setPreviewState] = useState(null);
  const activeRangeRef = useRef(null);
  const menuRef = useRef(null);
  const latestResponseRef = useRef('');
  
  const streamingAPI = useStreamingAPI();

  // Preset legal prompts for Croatian legal context
  const presetPrompts = [
    "Učini formalnijim za hrvatski sud",
    "Proširi uz relevantne pravne argumente",
    "Dodaj pravnu terminologiju",
    "Pojednostavi ovaj tekst",
    "Dodaj dodatne argumente",
    "Formatiraj kao pravni odlomak"
  ];

  // Handle preset prompt selection
  const handlePresetClick = useCallback(async (prompt, preview = true) => {
    if (!selectedText || isLoading) return;
    
    setIsLoading(true);
    setShowPresetButtons(false);
    setCustomPrompt(prompt);
    setPreviewState(null);
    activeRangeRef.current = selectionRange || (editor ? editor.state.selection : null);
    
    try {
      await streamingAPI.streamDocumentEdit(selectedText, prompt, {
        onContent: (content) => {
          // Buffer content and replace once on completion to reduce flicker
          latestResponseRef.current = content;
        },
        onComplete: (response) => {
          const finalText = latestResponseRef.current || response || '';
          if (editor && finalText) {
            const baseRange = activeRangeRef.current || editor.state.selection;
            const from = baseRange?.from ?? editor.state.selection.from;
            const to = baseRange?.to ?? editor.state.selection.to;
            if (preview) {
              const originalText = selectedText || '';
              const diffResult = buildTrackedChangesHtml(originalText, finalText);
              editor.chain()
                .focus()
                .deleteRange({ from, to })
                .insertContent(diffResult.html)
                .run();
              editor.commands.setTextSelection({ from, to: from + diffResult.textLength });
              setPreviewState({
                from,
                to: from + diffResult.textLength,
                originalText,
                finalText
              });
            } else {
              editor.chain()
                .focus()
                .deleteRange({ from, to })
                .insertContent(finalText)
                .run();
              onReplaceText?.(finalText);
              onClose?.();
            }
          }
          setIsLoading(false);
          setTimeout(() => {
            setCustomPrompt('');
            setShowPresetButtons(true);
          }, 1000);
        },
        onError: (error) => {
          setIsLoading(false);
          console.error('BubbleMenu AI error:', error);
        }
      }, {
        selectionRange,
        mode: preview ? 'preview' : 'direct'
      });
    } catch (error) {
      setIsLoading(false);
      console.error('BubbleMenu request failed:', error);
    }
  }, [selectedText, editor, onReplaceText, onClose, streamingAPI, isLoading, selectionRange]);

  const handleAcceptChanges = useCallback(() => {
    if (!editor || !previewState) return;
    editor.chain()
      .focus()
      .deleteRange({ from: previewState.from, to: previewState.to })
      .insertContent(previewState.finalText)
      .run();
    onReplaceText?.(previewState.finalText);
    setPreviewState(null);
    onClose?.();
  }, [editor, onReplaceText, onClose, previewState]);

  const handleRejectChanges = useCallback(() => {
    if (!editor || !previewState) return;
    editor.chain()
      .focus()
      .deleteRange({ from: previewState.from, to: previewState.to })
      .insertContent(previewState.originalText)
      .run();
    onReplaceText?.(previewState.originalText);
    setPreviewState(null);
    onClose?.();
  }, [editor, onReplaceText, onClose, previewState]);

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
        
        {showPresetButtons && !previewState ? (
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
          {showPresetButtons && !previewState && (
            <button
              onClick={() => setShowPresetButtons(false)}
              className="text-xs p-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors"
            >
              Prilagođena naredba
            </button>
          )}
          {showPresetButtons && !previewState && (
            <button
              onClick={() => handlePresetClick(customPrompt || 'Uredi označeni tekst', false)}
              disabled={isLoading || !selectedText}
              className="text-xs p-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Primijeni odmah
            </button>
          )}

          {previewState && (
            <>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 mr-auto">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-200 border border-emerald-300"></span>
                  Dodano
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-200 border border-slate-300"></span>
                  Uklonjeno
                </span>
              </div>
              <button
                onClick={handleAcceptChanges}
                className="text-xs p-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded transition-colors"
              >
                Prihvati
              </button>
              <button
                onClick={handleRejectChanges}
                className="text-xs p-2 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded transition-colors"
              >
                Odbaci
              </button>
            </>
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
