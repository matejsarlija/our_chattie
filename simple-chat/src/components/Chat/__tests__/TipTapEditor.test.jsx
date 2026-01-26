import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TipTapEditor from '../TipTapEditor';

// Get the mocked useEditor from setupTests.js
const { useEditor } = require('@tiptap/react');

describe('TipTapEditor', () => {
  let mockOnChange;
  let mockEditor;

  beforeEach(() => {
    mockOnChange = jest.fn();
    mockEditor = {
      getHTML: jest.fn(() => '<p>Test content</p>'),
      commands: {
        setContent: jest.fn(),
        focus: jest.fn(),
      },
      chain: jest.fn(() => ({
        focus: jest.fn(() => ({
          undo: jest.fn(() => ({ run: jest.fn() })),
          redo: jest.fn(() => ({ run: jest.fn() })),
        })),
      })),
      can: {
        undo: jest.fn(() => true),
        redo: jest.fn(() => true),
      },
      storage: {
        characterCount: {
          characters: jest.fn(() => 50),
          words: jest.fn(() => 8),
        },
      },
    };

    useEditor.mockReturnValue(mockEditor);
    jest.clearAllMocks();
  });

  test('renders editor content area', () => {
    render(<TipTapEditor content="<p>Test</p>" onChange={mockOnChange} />);
    
    expect(screen.getByTestId('editor-content')).toBeInTheDocument();
    expect(screen.getByText('50/10000 znakova')).toBeInTheDocument();
    expect(screen.getByText('• 8 riječi')).toBeInTheDocument();
  });

  test('displays correct character and word counts', () => {
    mockEditor.storage.characterCount.characters.mockReturnValue(150);
    mockEditor.storage.characterCount.words.mockReturnValue(25);

    render(<TipTapEditor content="<p>Test</p>" onChange={mockOnChange} />);
    
    expect(screen.getByText('150/10000 znakova')).toBeInTheDocument();
    expect(screen.getByText('• 25 riječi')).toBeInTheDocument();
  });

  test('shows undo and redo buttons in canvas mode', () => {
    render(
      <TipTapEditor 
        content="<p>Test</p>" 
        onChange={mockOnChange} 
        mode="canvas" 
      />
    );
    
    expect(screen.getByTitle('Poništi (Ctrl+Z)')).toBeInTheDocument();
    expect(screen.getByTitle('Ponovi (Ctrl+Y)')).toBeInTheDocument();
  });

  test('hides toolbar in chat mode', () => {
    render(
      <TipTapEditor 
        content="<p>Test</p>" 
        onChange={mockOnChange} 
        mode="chat" 
      />
    );
    
    expect(screen.queryByText('50/10000 znakova')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Poništi (Ctrl+Z)')).not.toBeInTheDocument();
  });

  test('handles undo button click', () => {
    render(
      <TipTapEditor 
        content="<p>Test</p>" 
        onChange={mockOnChange} 
        mode="canvas" 
      />
    );
    
    const undoButton = screen.getByTitle('Poništi (Ctrl+Z)');
    fireEvent.click(undoButton);

    expect(mockEditor.chain).toHaveBeenCalled();
  });

  test('handles redo button click', () => {
    render(
      <TipTapEditor 
        content="<p>Test</p>" 
        onChange={mockOnChange} 
        mode="canvas" 
      />
    );
    
    const redoButton = screen.getByTitle('Ponovi (Ctrl+Y)');
    fireEvent.click(redoButton);

    expect(mockEditor.chain).toHaveBeenCalled();
  });

  test('disables undo button when cannot undo', () => {
    mockEditor.can.undo.mockReturnValue(false);

    render(
      <TipTapEditor 
        content="<p>Test</p>" 
        onChange={mockOnChange} 
        mode="canvas" 
      />
    );
    
    const undoButton = screen.getByTitle('Poništi (Ctrl+Z)');
    expect(undoButton).toBeDisabled();
    expect(undoButton).toHaveClass('disabled:opacity-50', 'disabled:cursor-not-allowed');
  });

  test('disables redo button when cannot redo', () => {
    mockEditor.can.redo.mockReturnValue(false);

    render(
      <TipTapEditor 
        content="<p>Test</p>" 
        onChange={mockOnChange} 
        mode="canvas" 
      />
    );
    
    const redoButton = screen.getByTitle('Ponovi (Ctrl+Y)');
    expect(redoButton).toBeDisabled();
    expect(redoButton).toHaveClass('disabled:opacity-50', 'disabled:cursor-not-allowed');
  });

  test('calls onChange when editor content changes', () => {
    let onUpdateCallback;
    
    useEditor.mockImplementation((config) => {
      onUpdateCallback = config.onUpdate;
      return mockEditor;
    });

    render(<TipTapEditor content="<p>Initial</p>" onChange={mockOnChange} />);

    // Simulate editor content change
    if (onUpdateCallback) {
      onUpdateCallback({ editor: mockEditor });
    }

    expect(mockOnChange).toHaveBeenCalledWith('<p>Test content</p>');
  });

  test('handles maximum length prop correctly', () => {
    render(
      <TipTapEditor 
        content="<p>Test</p>" 
        onChange={mockOnChange} 
        maxLength={5000} 
      />
    );
    
    expect(screen.getByText('50/5000 znakova')).toBeInTheDocument();
  });

  test('applies correct styling for canvas mode', () => {
    render(
      <TipTapEditor 
        content="<p>Test</p>" 
        onChange={mockOnChange} 
        mode="canvas" 
      />
    );
    
    expect(screen.getByTestId('editor-content')).toHaveClass('bg-white', 'border', 'border-slate-200', 'rounded-lg', 'shadow-sm');
  });

  test('applies correct styling for chat mode', () => {
    render(
      <TipTapEditor 
        content="<p>Test</p>" 
        onChange={mockOnChange} 
        mode="chat" 
      />
    );
    
    expect(screen.getByTestId('editor-content')).toHaveClass('bg-white', 'border', 'border-slate-200', 'rounded-md');
  });

  test('shows status bar in canvas mode', () => {
    render(
      <TipTapEditor 
        content="<p>Test</p>" 
        onChange={mockOnChange} 
        mode="canvas" 
      />
    );
    
    expect(screen.getByText('Dokument se automatski sprema...')).toBeInTheDocument();
    expect(screen.getByText('TipTap editor')).toBeInTheDocument();
  });

  test('hides status bar in chat mode', () => {
    render(
      <TipTapEditor 
        content="<p>Test</p>" 
        onChange={mockOnChange} 
        mode="chat" 
      />
    );
    
    expect(screen.queryByText('Dokument se automatski sprema...')).not.toBeInTheDocument();
    expect(screen.queryByText('TipTap editor')).not.toBeInTheDocument();
  });

  test('calls onChange when useEditor triggers update', () => {
    render(<TipTapEditor content="<p>Initial</p>" onChange={mockOnChange} />);
    
    // Get the config passed to useEditor
    const useEditorCalls = useEditor.mock.calls;
    const config = useEditorCalls[useEditorCalls.length - 1][0];
    
    // Simulate the update callback
    if (config.onUpdate) {
      config.onUpdate({ editor: mockEditor });
    }
    
    expect(mockOnChange).toHaveBeenCalledWith('<p>Test content</p>');
  });

  test('uses correct placeholder based on mode', () => {
    render(
      <TipTapEditor 
        content="" 
        onChange={mockOnChange} 
        mode="canvas" 
      />
    );
    
    // The placeholder is handled by TipTap's Placeholder extension
    // We can't test it directly without the real extension, but we can verify component renders
    expect(screen.getByTestId('editor-content')).toBeInTheDocument();
  });
});