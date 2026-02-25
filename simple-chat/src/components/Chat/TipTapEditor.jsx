import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CharacterCount from '@tiptap/extension-character-count';
import Placeholder from '@tiptap/extension-placeholder';
import CitationNode from './CitationNode';
import InsertionMark from './InsertionMark';
import DeletionMark from './DeletionMark';
import { BubbleMenu as BubbleMenuExtension } from '@tiptap/extension-bubble-menu';
import BubbleMenuContent from './BubbleMenu';

export default function TipTapEditor({ 
  messageId,
  editorId,
  initialContent = '', 
  onChange,
  onError
}) {
  const [selectedText, setSelectedText] = useState('');
  const [selectionRange, setSelectionRange] = useState({ from: null, to: null });
  const [showBubbleMenu, setShowBubbleMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  // DE-105: State for vertical flip
  const [isFlipped, setIsFlipped] = useState(false);
  const debounceTimerRef = useRef(null);

  // DE-105: Shared position calculation logic
  const updateMenuPosition = useCallback((editorInstance) => {
    if (!editorInstance) return;
    
    const { from, to } = editorInstance.state.selection;
    if (from === to) return;

    const { view } = editorInstance;
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);

    // Constants for clamping
    const MENU_WIDTH_HALF = 160; 
    const PADDING = 24;
    const HEADER_OFFSET = 60; // Approximate top nav height

    // 1. Clamp Horizontal (Left)
    let left = (start.left + end.right) / 2;
    left = Math.max(MENU_WIDTH_HALF + PADDING, left); 
    left = Math.min(window.innerWidth - MENU_WIDTH_HALF - PADDING, left);

    // 2. Flip Vertical (Top)
    let top = start.top - 10;
    let flipped = false;

    // If top is too close to header/top of screen, flip to bottom
    if (top < HEADER_OFFSET + PADDING) {
      flipped = true;
      top = end.bottom + 10;
    }

    setMenuPosition({ top, left });
    setIsFlipped(flipped);
  }, []);
  
  const editor = useEditor({
    onError: (error) => {
      console.error('TipTap editor error:', error);
      onError?.(error);
    },
    extensions: [
      StarterKit,
      CharacterCount.configure({
        limit: 10000,
      }),
      Placeholder.configure({
        placeholder: 'Edit this content...',
      }),
      CitationNode,
      InsertionMark,
      DeletionMark,
      BubbleMenuExtension.configure({
        pluginKey: 'aiEditMenu',
        shouldShow: ({ from, to }) => from !== to,
      }),
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      
      // Debounce onChange to prevent excessive localStorage writes (500ms)
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      debounceTimerRef.current = setTimeout(() => {
        onChange?.(messageId, editorId, html);
      }, 500);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      const hasSelection = from !== to;
      
      if (hasSelection) {
        const selected = editor.state.doc.textBetween(from, to, ' ');
        setSelectedText(selected);
        setSelectionRange({ from, to });
        updateMenuPosition(editor);
      }
      
      setShowBubbleMenu(hasSelection);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-slate max-w-none focus:outline-none p-4 rounded-lg border border-slate-200 focus:border-blue-500 transition-colors text-sm min-h-[100px] max-h-[400px] overflow-y-auto',
        spellcheck: 'false',
      },
    },
  });

  // DE-105: Recompute position on scroll/resize
  useEffect(() => {
    if (!showBubbleMenu || !editor) return;

    const handleScrollOrResize = () => {
      requestAnimationFrame(() => updateMenuPosition(editor));
    };

    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true); // Capture phase for all scrollables

    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [showBubbleMenu, editor, updateMenuPosition]);


  // Handle external content changes (e.g., from localStorage)
  useEffect(() => {
    if (editor) {
      try {
        // Only set content if it's different and valid
        if (initialContent !== editor.getHTML() && initialContent) {
          editor.commands.setContent(initialContent);
        }
      } catch (error) {
        console.error('Error setting editor content:', error);
        // Fallback to empty content if invalid HTML
        editor.commands.setContent('<p>Error loading content</p>');
      }
    }
  }, [initialContent, editor]);
  
  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Handle text replacement from BubbleMenu
  const handleReplaceText = useCallback((newText) => {
    if (editor) {
      const { from, to } = editor.state.selection;
      editor.chain()
        .focus()
        .deleteRange({ from, to })
        .insertContent(newText)
        .run();
    }
  }, [editor]);

  // Handle bubble menu close
  const handleCloseBubbleMenu = useCallback(() => {
    setShowBubbleMenu(false);
    editor?.chain().focus().run();
  }, [editor]);

  const isMobile = window.innerWidth < 768;

  return (
    <div className="w-full">
      {/* Editor Content with auto-expanding height */}
      <EditorContent 
        editor={editor} 
        className="bg-white border border-slate-200 rounded-md shadow-sm"
      />

      {/* BubbleMenu - Desktop: Floating, Mobile: Modal */}
      {editor && showBubbleMenu && (
        <div 
          className={isMobile ? "" : `fixed z-50 transform -translate-x-1/2 ${isFlipped ? '' : '-translate-y-full'}`}
          style={isMobile ? {} : { 
            top: `${menuPosition.top}px`, 
            left: `${menuPosition.left}px` 
          }}
        >
          <BubbleMenuContent
            editor={editor}
            selectedText={selectedText}
            selectionRange={selectionRange}
            onReplaceText={handleReplaceText}
            onClose={handleCloseBubbleMenu}
            isMobile={isMobile}
          />
        </div>
      )}
    </div>
  );
}
