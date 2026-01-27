import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChatInput from '../ChatInput';
import { useChat } from '../../../contexts/ChatContext';

// Mock useChat hook
jest.mock('../../../contexts/ChatContext', () => ({
  useChat: jest.fn(),
}));

// Mock useFileUpload hook
jest.mock('../../../hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    selectedFile: null,
    handleFileSelect: jest.fn(),
    removeFile: jest.fn(),
    triggerFileInput: jest.fn(),
    fileInputRef: { current: null }
  })
}));

describe('ChatInput', () => {
  const defaultProps = {
    inputText: '',
    setInputText: jest.fn(),
    onSend: jest.fn(),
    selectedFile: null,
    onFileSelect: jest.fn()
  };

  beforeEach(() => {
    useChat.mockReturnValue({
      isLoading: false,
      error: '',
    });
    jest.clearAllMocks();
  });

  it('renders correctly', () => {
    render(<ChatInput {...defaultProps} />);
    
    expect(screen.getByPlaceholderText('Postavite svoje pravno pitanje...')).toBeInTheDocument();
  });

  it('renders suggestion buttons on desktop', () => {
    render(<ChatInput {...defaultProps} />);
    
    // Suggestion buttons should be present (hidden on mobile via CSS but present in DOM)
    expect(screen.getByText('Nisam u stanju otplatiti ratu kredita')).toBeInTheDocument();
  });

  it('calls setInputText when user types', () => {
    const mockSetInputText = jest.fn();
    render(<ChatInput {...defaultProps} setInputText={mockSetInputText} />);
    
    const textarea = screen.getByPlaceholderText('Postavite svoje pravno pitanje...');
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    
    expect(mockSetInputText).toHaveBeenCalledWith('Test message');
  });

  it('shows stop button when loading', () => {
    useChat.mockReturnValue({
      isLoading: true,
      error: '',
    });

    render(<ChatInput {...defaultProps} />);
    
    // The button aria-label should be "Zaustavi"
    expect(screen.getByLabelText('Zaustavi')).toBeInTheDocument();
  });

  it('shows error message when present in chat context', () => {
    useChat.mockReturnValue({
      isLoading: false,
      error: 'API Error',
    });

    render(<ChatInput {...defaultProps} />);
    
    expect(screen.getByText('API Error')).toBeInTheDocument();
  });
});
