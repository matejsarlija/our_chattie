/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import TipTapEditor from '../TipTapEditor';

describe('TipTapEditor', () => {
  it('renders editor content with base styling', () => {
    render(
      <TipTapEditor
        messageId="m1"
        editorId="e1"
        initialContent="<p>Hello</p>"
      />
    );

    const editorContent = screen.getByTestId('editor-content');
    expect(editorContent).toBeInTheDocument();
    expect(editorContent.className).toContain('bg-white');
  });

  it('does not render bubble menu by default', () => {
    render(
      <TipTapEditor
        messageId="m1"
        editorId="e1"
        initialContent="<p>Hello</p>"
      />
    );

    expect(screen.queryByText(/Uredite označeni tekst/i)).not.toBeInTheDocument();
  });
});
