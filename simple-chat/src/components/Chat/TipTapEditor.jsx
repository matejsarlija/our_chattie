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
  const debounceTimerRef = useRef(null);
  
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
        
        // Calculate position for the menu
        const { view } = editor;
        const start = view.coordsAtPos(from);
        const end = view.coordsAtPos(to);
        
        // Center horizontally over selection, position above
        const left = (start.left + end.right) / 2;
        const top = start.top - 10; // 10px offset above
        
        setMenuPosition({ top, left });
      }
      
      setShowBubbleMenu(hasSelection);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-slate max-w-none focus:outline-none p-4 rounded-lg border border-slate-200 focus:border-blue-500 transition-colors text-sm',
        spellcheck: 'false',
      },
    },
  });

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
        style={{
          '.ProseMirror': {
            minHeight: '100px',
            maxHeight: '400px',
            overflowY: 'auto',
          }
        }}
      />

      {/* BubbleMenu - Desktop: Floating, Mobile: Modal */}
      {editor && showBubbleMenu && (
        <div 
          className={isMobile ? "" : "fixed z-50 transform -translate-x-1/2 -translate-y-full"}
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
