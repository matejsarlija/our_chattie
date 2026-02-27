import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useStreamingAPI } from '../../hooks/useStreamingAPI';
import { buildTrackedChangesHtml } from '../../hooks/utils/diffUtils';
import Shimmer from './Shimmer';

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
  // DE-106: Preset Taxonomy Cleanup
  const presetPrompts = [
    { label: "Učini formalnijim", prompt: "Učini formalnijim" },
    { label: "Pojednostavi", prompt: "Pojednostavi" },
    { label: "Dodaj pravne argumente", prompt: "Dodaj pravne argumente" },
    { label: "Formatiraj", prompt: "Formatiraj tekst za bolju čitljivost i strukturu, ali ne mijenjaj pravno značenje." }
  ];

  // DE-102: Custom prompt handlers
  const handleCustomSubmit = useCallback(() => {
    if (!customPrompt.trim()) return;
    // DE-103: Custom prompts always use preview
    handlePresetClick(customPrompt, true);
  }, [customPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleCustomSubmit();
    }
  };

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
              // DE-101: Single writer policy - BubbleMenu handles mutation directly
              editor.chain()
                .focus()
                .deleteRange({ from, to })
                .insertContent(finalText)
                .run();
              // Removed duplicate onReplaceText call
              onClose?.();
            }
          }
          setIsLoading(false);
          // Only reset prompt if we're not in preview mode (if we are, we wait for Accept/Reject)
          if (!preview) {
            setTimeout(() => {
              setCustomPrompt('');
              setShowPresetButtons(true);
            }, 1000);
          }
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
  }, [selectedText, editor, onClose, streamingAPI, isLoading, selectionRange]);

  const handleAcceptChanges = useCallback(() => {
    if (!editor || !previewState) return;
    editor.chain()
      .focus()
      .deleteRange({ from: previewState.from, to: previewState.to })
      .insertContent(previewState.finalText)
      .run();
    // Removed duplicate onReplaceText call
    setPreviewState(null);
    onClose?.();
  }, [editor, onClose, previewState]);

  const handleRejectChanges = useCallback(() => {
    if (!editor || !previewState) return;
    editor.chain()
      .focus()
      .deleteRange({ from: previewState.from, to: previewState.to })
      .insertContent(previewState.originalText)
      .run();
    // Removed duplicate onReplaceText call
    setPreviewState(null);
    onClose?.();
  }, [editor, onClose, previewState]);

  // DE-104: Smart Cancel
  const handleCancel = useCallback(() => {
    if (isLoading) {
      streamingAPI.stopGeneration();
    }

    if (previewState) {
      handleRejectChanges();
    } else {
      onClose?.();
      setCustomPrompt('');
      setShowPresetButtons(true);
    }
  }, [previewState, handleRejectChanges, onClose, isLoading, streamingAPI]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleCancel]);

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
            {presetPrompts.map((preset, index) => (
              <button
                key={index}
                onClick={() => handlePresetClick(preset.prompt)}
                disabled={isLoading}
                className="text-left text-xs p-2 bg-slate-100 hover:bg-slate-200 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-3 space-y-2">
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Kako da uredim ovaj tekst?"
              className="w-full p-2 border border-slate-300 rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              disabled={isLoading}
              autoFocus
            />

            {/* DE-102: Submit button */}
            <div className="flex gap-2">
              <button
                onClick={handleCustomSubmit}
                disabled={isLoading || !customPrompt.trim()}
                className="flex-1 text-xs p-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                Primijeni prijedlog
              </button>
            </div>
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
          {/* DE-103: Removed ambiguous "Primijeni odmah" button to enforce preview flow */}

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
              {/* DE-104: Removed Odbaci */}
            </>
          )}

          <button
            onClick={handleCancel}
            className="text-xs p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
          >
            Otkaži
          </button>
        </div>

        {isLoading && (
          <div className="text-xs text-center mt-2">
            <Shimmer duration={1.5} spread={2}>
              AI obrađuje...
            </Shimmer>
          </div>
        )}
      </div>
    </div>
  );
}
