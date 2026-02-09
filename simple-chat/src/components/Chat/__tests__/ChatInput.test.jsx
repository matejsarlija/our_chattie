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
    onStop: jest.fn(),
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

  it('sends on Enter but not on Shift+Enter', () => {
    const mockOnSend = jest.fn();
    render(<ChatInput {...defaultProps} onSend={mockOnSend} />);

    const textarea = screen.getByPlaceholderText('Postavite svoje pravno pitanje...');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(mockOnSend).toHaveBeenCalledTimes(1);
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

  it('calls onStop when loading and stop is clicked', () => {
    useChat.mockReturnValue({
      isLoading: true,
      error: '',
    });

    const mockOnStop = jest.fn();
    render(<ChatInput {...defaultProps} onStop={mockOnStop} />);

    fireEvent.click(screen.getByLabelText('Zaustavi'));
    expect(mockOnStop).toHaveBeenCalled();
  });

  it('fills input when suggestion clicked', () => {
    const mockSetInputText = jest.fn();
    render(<ChatInput {...defaultProps} setInputText={mockSetInputText} />);

    fireEvent.click(screen.getByText('Nisam u stanju otplatiti ratu kredita'));
    expect(mockSetInputText).toHaveBeenCalledWith('Nisam u stanju otplatiti ratu kredita');
  });

  it('focuses the textarea after suggestion click', () => {
    render(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Postavite svoje pravno pitanje...');
    const focusSpy = jest.spyOn(textarea, 'focus');

    fireEvent.click(screen.getByText('Nisam u stanju otplatiti ratu kredita'));

    expect(focusSpy).toHaveBeenCalled();
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
