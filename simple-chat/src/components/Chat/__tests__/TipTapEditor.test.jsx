/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import TipTapEditor from '../TipTapEditor';

// Mock dependencies
const mockUseEditor = jest.fn();
jest.mock('@tiptap/react', () => ({
  useEditor: (props) => mockUseEditor(props),
  EditorContent: () => <div data-testid="editor-content" />,
  BubbleMenu: { configure: jest.fn() }
}));

// Mock starter kit and extensions
jest.mock('@tiptap/starter-kit', () => ({}));
jest.mock('@tiptap/extension-character-count', () => ({ configure: jest.fn() }));
jest.mock('@tiptap/extension-placeholder', () => ({ configure: jest.fn() }));
jest.mock('../CitationNode', () => ({}));
jest.mock('../InsertionMark', () => ({}));
jest.mock('../DeletionMark', () => ({}));
// Mock BubbleMenu extension
jest.mock('@tiptap/extension-bubble-menu', () => ({
  BubbleMenu: { configure: jest.fn() }
}));
// Mock BubbleMenuContent to simplify assertion and avoid API calls
jest.mock('../BubbleMenu', () => () => <div data-testid="bubble-menu-content">Menu</div>);

describe('TipTapEditor Positioning (DE-105)', () => {
  let mockEditorInstance;
  let onSelectionUpdateCallback;

  beforeEach(() => {
    // Reset mocks
    mockUseEditor.mockReset();
    
    // Default mock implementation for useEditor
    mockUseEditor.mockImplementation((config) => {
      onSelectionUpdateCallback = config.onSelectionUpdate;
      
      mockEditorInstance = {
        state: {
          selection: { from: 0, to: 0 },
          doc: { textBetween: jest.fn(() => '') }
        },
        view: {
          coordsAtPos: jest.fn()
        },
        chain: jest.fn(() => ({ focus: jest.fn(() => ({ run: jest.fn() })) })),
        isDestroyed: false,
        options: { element: document.createElement('div') },
        commands: { setContent: jest.fn() },
        getHTML: jest.fn(() => ''),
      };
      
      return mockEditorInstance;
    });

    // Mock window dimensions
    global.innerWidth = 1024;
    global.innerHeight = 768;
  });

  const renderEditor = () => {
    render(
      <TipTapEditor
        messageId="msg-1"
        editorId="editor-1"
        initialContent="Test content"
      />
    );
  };

  test('DE-105: Menu flips to bottom when selection is near top edge', () => {
    renderEditor();

    // Trigger selection update with coordinates near top (e.g., top: 50)
    // Threshold in code is HEADER_OFFSET (60) + PADDING (24) = 84
    const nearTopCoords = { top: 50, left: 200, right: 300, bottom: 70 };
    
    mockEditorInstance.state.selection = { from: 10, to: 20 };
    mockEditorInstance.state.doc.textBetween.mockReturnValue('Selected Text');
    mockEditorInstance.view.coordsAtPos.mockReturnValue(nearTopCoords);

    act(() => {
      onSelectionUpdateCallback({ editor: mockEditorInstance });
    });

    const menuContainer = screen.getByTestId('bubble-menu-content').parentElement;
    
    // Check if vertical flip logic applied (should not have -translate-y-full)
    expect(menuContainer.className).not.toContain('-translate-y-full');
    
    // Verify top position (should be bottom of selection + 10 = 70 + 10 = 80)
    expect(menuContainer.style.top).toBe('80px');
  });

  test('DE-105: Menu stays above when selection is far from top', () => {
    renderEditor();

    // Trigger selection update with coordinates far from top (e.g., top: 200)
    const normalCoords = { top: 200, left: 200, right: 300, bottom: 220 };
    
    mockEditorInstance.state.selection = { from: 10, to: 20 };
    mockEditorInstance.state.doc.textBetween.mockReturnValue('Selected Text');
    mockEditorInstance.view.coordsAtPos.mockReturnValue(normalCoords);

    act(() => {
      onSelectionUpdateCallback({ editor: mockEditorInstance });
    });

    const menuContainer = screen.getByTestId('bubble-menu-content').parentElement;
    
    // Check if normal positioning applied (should have -translate-y-full)
    expect(menuContainer.className).toContain('-translate-y-full');
    
    // Verify top position (should be top of selection - 10 = 200 - 10 = 190)
    expect(menuContainer.style.top).toBe('190px');
  });

  test('DE-105: Menu is clamped horizontally (left edge)', () => {
    renderEditor();

    // Trigger selection update with coordinates near left edge (e.g., left: 10)
    // Midpoint would be (10+50)/2 = 30
    // Constraint: MENU_WIDTH_HALF (160) + PADDING (24) = 184
    const nearLeftCoords = { top: 200, left: 10, right: 50, bottom: 220 };
    
    mockEditorInstance.state.selection = { from: 10, to: 20 };
    mockEditorInstance.state.doc.textBetween.mockReturnValue('Selected Text');
    mockEditorInstance.view.coordsAtPos.mockReturnValue(nearLeftCoords);

    act(() => {
      onSelectionUpdateCallback({ editor: mockEditorInstance });
    });

    const menuContainer = screen.getByTestId('bubble-menu-content').parentElement;
    
    // Verify left position is clamped to 184
    expect(menuContainer.style.left).toBe('184px');
  });
});
