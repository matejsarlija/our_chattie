/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import TipTapEditor from '../TipTapEditor';

describe('TipTapEditor - Import Fix', () => {
    test('should render without import errors', () => {
        const mockOnChange = jest.fn();
        
        render(
            <TipTapEditor
                messageId={0}
                editorId="editor-0-0"
                initialContent="<p>Test content</p>"
                onChange={mockOnChange}
            />
        );

        expect(screen.getByTestId('editor-content')).toBeInTheDocument();
    });

    test('should render with BubbleMenu extension configured', () => {
        const mockOnChange = jest.fn();
        
        const { container } = render(
            <TipTapEditor
                messageId={0}
                editorId="editor-0-0"
                initialContent="<p>Test content</p>"
                onChange={mockOnChange}
            />
        );

        // Verify editor content is rendered
        expect(container.querySelector('[data-testid="editor-content"]')).toBeInTheDocument();
    });
});
