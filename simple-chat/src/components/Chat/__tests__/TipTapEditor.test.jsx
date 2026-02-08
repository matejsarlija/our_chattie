import React from 'react';
import { render, screen } from '@testing-library/react';
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
    render(
      <TipTapEditor
        messageId={1}
        editorId="editor-1"
        initialContent="<p>Test</p>"
        onChange={mockOnChange}
      />
    );

    expect(screen.getByTestId('editor-content')).toBeInTheDocument();
  });

  test('calls onChange when editor content changes (debounced)', () => {
    jest.useFakeTimers();

    let onUpdateCallback;

    useEditor.mockImplementation((config) => {
      onUpdateCallback = config.onUpdate;
      return mockEditor;
    });

    render(
      <TipTapEditor
        messageId={2}
        editorId="editor-2"
        initialContent="<p>Initial</p>"
        onChange={mockOnChange}
      />
    );

    if (onUpdateCallback) {
      onUpdateCallback({ editor: mockEditor });
    }

    jest.advanceTimersByTime(500);

    expect(mockOnChange).toHaveBeenCalledWith(2, 'editor-2', '<p>Test content</p>');

    jest.useRealTimers();
  });

  test('applies base editor styling', () => {
    render(
      <TipTapEditor
        messageId={3}
        editorId="editor-3"
        initialContent="<p>Test</p>"
        onChange={mockOnChange}
      />
    );

    expect(screen.getByTestId('editor-content')).toHaveClass(
      'bg-white',
      'border',
      'border-slate-200',
      'rounded-md',
      'shadow-sm'
    );
  });
});
