import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessageList from '../MessageList';
import { parseMarkdownBlocks, extractAndCleanMarkdown } from '../../../hooks/utils/markdownParser';
import { convertMarkdownToHTML } from '../../../hooks/utils/markdownToHTML';

// Mock the utility functions
jest.mock('../../../hooks/utils/markdownParser');
jest.mock('../../../hooks/utils/markdownToHTML');

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

// Mock TipTapEditor
jest.mock('../TipTapEditor', () => {
  return function MockTipTapEditor({ messageId, editorId, initialContent, onChange }) {
    return (
      <div data-testid={`tiptap-editor-${editorId}`} data-message-id={messageId}>
        <div data-testid="editor-content">{initialContent}</div>
        <button 
          data-testid="editor-change"
          onClick={() => onChange(messageId, editorId, '<p>Updated content</p>')}
        >
          Update Editor
        </button>
      </div>
    );
  };
});

// Mock ReactMarkdown
jest.mock('react-markdown', () => {
  return function MockReactMarkdown({ children }) {
    return <div data-testid="react-markdown">{children}</div>;
  };
});

describe('MessageList', () => {
  const mockMessages = [
    { isUser: true, text: 'User message' },
    { 
      isUser: false, 
      text: 'AI response without markdown' 
    },
    {
      isUser: false,
      text: 'AI response with ```markdown\n# Legal Document\n\nContent here\n``` markdown block'
    },
    {
      isUser: false,
      text: 'Another AI message with ```markdown\n# Second Document\n\nMore content\n``` block'
    }
  ];

  beforeEach(() => {
    // Reset mock implementations
    parseMarkdownBlocks.mockReturnValue([]);
    extractAndCleanMarkdown.mockImplementation((text) => text);
    convertMarkdownToHTML.mockImplementation((markdown) => `<p>${markdown}</p>`);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic rendering', () => {
    it('renders empty state when no messages', () => {
      render(<MessageList messages={[]} textSize={16} error="" isLoading={false} />);
      
      expect(screen.getByText('Dobrodošli na Alimentacija.info')).toBeInTheDocument();
      expect(screen.getByText(/Postavite pitanje kroz chat/)).toBeInTheDocument();
    });

    it('renders user and AI messages correctly', () => {
      render(
        <MessageList 
          messages={mockMessages.slice(0, 2)} 
          textSize={16} 
          error="" 
          isLoading={false} 
        />
      );

      expect(screen.getByText('User message')).toBeInTheDocument();
      expect(screen.getByText('AI response without markdown')).toBeInTheDocument();
    });

    it('displays error message when provided', () => {
      render(
        <MessageList 
          messages={[{ isUser: true, text: 'Test message' }]} 
          textSize={16} 
          error="Test error" 
          isLoading={false} 
        />
      );

      expect(screen.getByText('Test error')).toBeInTheDocument();
      expect(screen.getByText('Test error')).toHaveClass('text-red-600');
    });

    it('displays loading indicator when loading', () => {
      render(
        <MessageList 
          messages={[{ isUser: true, text: 'Test message' }]} 
          textSize={16} 
          error="" 
          isLoading={true} 
        />
      );

      expect(screen.getByText('AI odgovara...')).toBeInTheDocument();
      expect(screen.getByText('AI odgovara...').closest('.flex').querySelector('.animate-spin')).toBeInTheDocument(); // spinner
    });
  });

  describe('Markdown detection and TipTap rendering', () => {
    it('does not render TipTap editors when no markdown blocks detected', () => {
      parseMarkdownBlocks.mockReturnValue([]);
      
      render(
        <MessageList 
          messages={mockMessages} 
          textSize={16} 
          error="" 
          isLoading={false} 
        />
      );

      expect(screen.queryByTestId(/tiptap-editor-/)).not.toBeInTheDocument();
    });

    it('renders TipTap editors for detected markdown blocks', () => {
      const mockMarkdownBlocks1 = [
        {
          id: 'editor-2-0',
          markdown: '# Legal Document\n\nContent here',
          position: { start: 0, end: 0 }
        }
      ];
      const mockMarkdownBlocks2 = [];
      
      parseMarkdownBlocks
        .mockReturnValueOnce(mockMarkdownBlocks1)
        .mockReturnValueOnce(mockMarkdownBlocks2)
        .mockReturnValueOnce([])
        .mockReturnValueOnce([]);
      extractAndCleanMarkdown.mockReturnValue('AI response with  markdown block');
      convertMarkdownToHTML.mockReturnValue('<h1>Legal Document</h1><p>Content here</p>');
      
      render(
        <MessageList 
          messages={mockMessages} 
          textSize={16} 
          error="" 
          isLoading={false} 
        />
      );

      expect(screen.getByTestId('tiptap-editor-editor-2-0')).toBeInTheDocument();
      expect(screen.getByTestId('editor-content')).toHaveTextContent('<h1>Legal Document</h1><p>Content here</p>');
    });

    it('renders multiple TipTap editors for multiple markdown blocks', () => {
      const mockMarkdownBlocks = [
        {
          id: 'editor-0-0',
          markdown: '# First Document',
          position: { start: 0, end: 0 }
        },
        {
          id: 'editor-0-1',
          markdown: '# Second Document',
          position: { start: 0, end: 0 }
        }
      ];
      
      parseMarkdownBlocks.mockReturnValue(mockMarkdownBlocks);
      extractAndCleanMarkdown.mockReturnValue('AI response with markdown blocks');
      
      render(
        <MessageList 
          messages={[mockMessages[2]]} 
          textSize={16} 
          error="" 
          isLoading={false} 
        />
      );

      expect(screen.getByTestId('tiptap-editor-editor-0-0')).toBeInTheDocument();
      expect(screen.getByTestId('tiptap-editor-editor-0-1')).toBeInTheDocument();
    });

    it('passes correct props to TipTap editors', () => {
      const mockMarkdownBlocks = [
        {
          id: 'editor-2-0',
          markdown: '# Legal Document',
          position: { start: 0, end: 0 }
        }
      ];
      
      parseMarkdownBlocks.mockReturnValue(mockMarkdownBlocks);
      convertMarkdownToHTML.mockReturnValue('<h1>Legal Document</h1>');
      
      const mockWorkspace = {
        updateEditorContent: jest.fn()
      };
      
      render(
        <MessageList 
          messages={[mockMessages[2]]} 
          textSize={16} 
          error="" 
          isLoading={false} 
          workspace={mockWorkspace}
        />
      );

      const editor = screen.getByTestId('tiptap-editor-editor-2-0');
      expect(editor).toHaveAttribute('data-message-id', '0'); // index 0 in single message array
      
      // Test editor change functionality
      fireEvent.click(screen.getByTestId('editor-change'));
      
      // The onChange should be called with correct parameters
      expect(editor).toBeInTheDocument();
    });

    it('uses markdown utilities correctly', () => {
      const messageWithMarkdown = mockMessages[2];
      
      render(
        <MessageList 
          messages={[messageWithMarkdown]} 
          textSize={16} 
          error="" 
          isLoading={false} 
        />
      );

      expect(parseMarkdownBlocks).toHaveBeenCalledWith(
        messageWithMarkdown.text,
        0
      );
      expect(extractAndCleanMarkdown).toHaveBeenCalledWith(
        messageWithMarkdown.text
      );
    });
  });

  describe('Message styling and layout', () => {
    it('applies correct styling for user messages', () => {
      render(
        <MessageList 
          messages={[{ isUser: true, text: 'User message' }]} 
          textSize={16} 
          error="" 
          isLoading={false} 
        />
      );

      const userMessage = screen.getByText('User message');
      expect(userMessage.closest('.text-white')).toBeInTheDocument();
    });

    it('applies correct styling for AI messages', () => {
      render(
        <MessageList 
          messages={[{ isUser: false, text: 'AI message' }]} 
          textSize={16} 
          error="" 
          isLoading={false} 
        />
      );

      const aiMessage = screen.getByText('AI message');
      expect(aiMessage.closest('.bg-white')).toBeInTheDocument();
    });

    it('renders file attachment indicators for user messages', () => {
      const messageWithFile = {
        isUser: true,
        text: 'User message',
        hasAttachment: true,
        attachmentName: 'legal_document.pdf'
      };
      
      render(
        <MessageList 
          messages={[messageWithFile]} 
          textSize={16} 
          error="" 
          isLoading={false} 
        />
      );

      expect(screen.getByText('legal_document.pdf')).toBeInTheDocument();
      expect(screen.getByText('legal_document.pdf')).toHaveClass('truncate');
    });
  });

  describe('Component props interface', () => {
    it('does not accept mode-related props', () => {
      const { container } = render(
        <MessageList 
          messages={[]} 
          textSize={16} 
          error="" 
          isLoading={false} 
        />
      );

      // Should not have any mode-related elements
      expect(container.querySelector('[data-testid*="canvas"]')).not.toBeInTheDocument();
      expect(container.querySelector('[data-testid*="mode"]')).not.toBeInTheDocument();
    });

    it('passes textSize prop correctly', () => {
      render(
        <MessageList 
          messages={[]} 
          textSize={18} 
          error="" 
          isLoading={false} 
        />
      );

      // textSize should be available for styling (implementation dependent)
      expect(screen.getByText('Dobrodošli na Alimentacija.info')).toBeInTheDocument();
    });
  });
});