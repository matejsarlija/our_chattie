import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import BubbleMenuContent from '../BubbleMenu';

// Mock useStreamingAPI
const mockStreamDocumentEdit = jest.fn();
jest.mock('../../../hooks/useStreamingAPI', () => ({
  useStreamingAPI: () => ({
    streamDocumentEdit: mockStreamDocumentEdit,
  }),
}));

// Mock buildTrackedChangesHtml
jest.mock('../../../hooks/utils/diffUtils', () => ({
  buildTrackedChangesHtml: (original, final) => ({
    html: `<span class="diff-removed">${original}</span><span class="diff-added">${final}</span>`,
    textLength: final.length
  })
}));

describe('BubbleMenuContent', () => {
  let mockEditor;
  let mockOnReplaceText;
  let mockOnClose;

  beforeEach(() => {
    mockOnReplaceText = jest.fn();
    mockOnClose = jest.fn();
    mockStreamDocumentEdit.mockReset(); 
    
    // Setup default mock implementation
    mockStreamDocumentEdit.mockImplementation((text, prompt, callbacks) => {
       // Simulate async response
       setTimeout(() => {
           callbacks.onComplete("Updated text");
       }, 10);
       return Promise.resolve();
    });

    // Mock Tiptap editor chain with simplified structure
    const chainResult = {
        focus: jest.fn(() => ({
            deleteRange: jest.fn(() => ({
                insertContent: jest.fn(() => ({
                    run: jest.fn()
                }))
            }))
        }))
    };

    const mockSetTextSelection = jest.fn();

    mockEditor = {
      state: {
        selection: { from: 10, to: 20 },
      },
      chain: jest.fn(() => chainResult),
      commands: {
        setTextSelection: mockSetTextSelection
      }
    };
  });

  const renderComponent = (props = {}) => {
    return render(
      <BubbleMenuContent
        editor={mockEditor}
        selectedText="Original text"
        selectionRange={{ from: 10, to: 20 }}
        onReplaceText={mockOnReplaceText}
        onClose={mockOnClose}
        isMobile={false}
        {...props}
      />
    );
  };

  test('DE-106: Renders only the 3 approved presets', () => {
    renderComponent();
    
    expect(screen.getByText('Učini formalnijim')).toBeInTheDocument();
    expect(screen.getByText('Pojednostavi')).toBeInTheDocument();
    expect(screen.getByText('Dodaj pravne argumente')).toBeInTheDocument();
    
    // Ensure old presets are gone
    expect(screen.queryByText('Učini formalnijim za hrvatski sud')).not.toBeInTheDocument();
  });

  test('DE-101: Preset click triggers mutation exactly once via editor chain (Single Writer)', async () => {
    renderComponent();
    
    fireEvent.click(screen.getByText('Učini formalnijim'));
    
    // Wait for the chain call to ensure async logic completed
    await waitFor(() => {
      expect(mockEditor.chain).toHaveBeenCalled();
    });

    // Verify preview mutation happened
    expect(mockEditor.chain).toHaveBeenCalledTimes(1);
    expect(mockOnReplaceText).not.toHaveBeenCalled();
  });

  test('DE-102: Custom prompt submit works via button', async () => {
    renderComponent();
    fireEvent.click(screen.getByText('Prilagođena naredba'));
    
    const textarea = screen.getByPlaceholderText('Kako da uredim ovaj tekst?');
    fireEvent.change(textarea, { target: { value: 'Make it better' } });
    fireEvent.click(screen.getByText('Primijeni prijedlog'));
    
    // Wait for side effect
    await waitFor(() => {
      expect(mockStreamDocumentEdit).toHaveBeenCalledWith(
        'Original text',
        'Make it better',
        expect.anything(),
        expect.objectContaining({ mode: 'preview' })
      );
      expect(mockEditor.chain).toHaveBeenCalled();
    });
  });

  test('DE-102: Custom prompt submit works via Enter key', async () => {
    renderComponent();
    fireEvent.click(screen.getByText('Prilagođena naredba'));
    
    const textarea = screen.getByPlaceholderText('Kako da uredim ovaj tekst?');
    fireEvent.change(textarea, { target: { value: 'Make it better' } });
    
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', charCode: 13 });
    
    await waitFor(() => {
      expect(mockEditor.chain).toHaveBeenCalled();
    });
  });

  test('DE-106: Format quick action triggers specific prompt', async () => {
    renderComponent();
    fireEvent.click(screen.getByText('Prilagođena naredba'));
    
    fireEvent.click(screen.getByTitle('Formatiraj strukturu')); 
    
    await waitFor(() => {
      expect(mockStreamDocumentEdit).toHaveBeenCalledWith(
        'Original text',
        "Formatiraj tekst za bolju čitljivost i strukturu, ali ne mijenjaj pravno značenje.",
        expect.anything(),
        expect.anything()
      );
      expect(mockEditor.chain).toHaveBeenCalled();
    });
  });

  test('DE-104: Otkaži (Cancel) behavior', async () => {
    // 1. Test Simple Cancel (No Preview)
    const { unmount } = renderComponent();
    
    fireEvent.click(screen.getByText('Otkaži'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    
    unmount();
    mockOnClose.mockClear();

    // 2. Test Smart Cancel (With Preview)
    renderComponent();
    fireEvent.click(screen.getByText('Učini formalnijim'));
    
    // Wait for preview to render (Accept button appears)
    await waitFor(() => {
      expect(screen.getByText('Prihvati')).toBeInTheDocument();
    });
    
    mockEditor.chain.mockClear(); 
    fireEvent.click(screen.getByText('Otkaži'));
    
    // Should revert changes 
    expect(mockEditor.chain).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });
});
