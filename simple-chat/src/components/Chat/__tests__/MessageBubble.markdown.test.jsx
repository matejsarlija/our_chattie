/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import MessageBubble from '../MessageBubble';

jest.mock('../../../contexts/ChatContext', () => ({
  useChat: () => ({ updateEditorContent: jest.fn() }),
}));

jest.mock('../TipTapEditor', () => ({
  __esModule: true,
  default: ({ initialContent }) => (
    <div data-testid="tiptap-editor">{initialContent}</div>
  ),
}));

describe('MessageBubble markdown fallback', () => {
  it('parses markdown blocks into editors when msg.editors is missing', () => {
    const msg = {
      text: 'Intro\n```markdown\nHello **world**\n```',
      isUser: false,
      timestamp: 't1',
    };

    render(<MessageBubble msg={msg} index={0} />);

    expect(screen.getByText('Intro')).toBeInTheDocument();
    const editor = screen.getByTestId('tiptap-editor');
    expect(editor).toBeInTheDocument();
    expect(editor.textContent).toContain('<p>Hello <strong>world</strong></p>');
  });

  it('renders pre-processed editors when msg.editors is present', () => {
    const msg = {
      text: 'Cleaned text',
      isUser: false,
      timestamp: 't2',
      editors: [
        { id: 'editor-0-0', content: '<p>Ready</p>' },
      ],
    };

    render(<MessageBubble msg={msg} index={0} />);

    expect(screen.getByText('Cleaned text')).toBeInTheDocument();
    const editor = screen.getByTestId('tiptap-editor');
    expect(editor).toBeInTheDocument();
    expect(editor.textContent).toContain('<p>Ready</p>');
  });
});
