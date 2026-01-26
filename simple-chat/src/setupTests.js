// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Polyfill for TextEncoder/TextDecoder for Node.js environment
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock TipTap modules at the top level to avoid import issues
jest.mock('@tiptap/react', () => ({
  useEditor: jest.fn(() => ({
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
  })),
  EditorContent: ({ editor, className }) => 
    <div data-testid="editor-content" className={className}>
      {editor?.getHTML() || '<p></p>'}
    </div>,
}));

jest.mock('@tiptap/starter-kit', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('@tiptap/extension-character-count', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(() => ({})),
  },
}));

jest.mock('@tiptap/extension-placeholder', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(() => ({})),
  },
}));

jest.mock('@tiptap/extension-bubble-menu', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('@tiptap/core', () => ({
  __esModule: true,
  Node: {
    create: jest.fn(() => ({
      name: 'citation',
      group: 'inline',
      inline: true,
      atom: true,
      addAttributes: jest.fn(() => ({})),
      addCommands: jest.fn(() => ({})),
      addNodeView: jest.fn(() => ({})),
    })),
  },
}));
