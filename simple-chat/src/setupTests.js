import '@testing-library/jest-dom/vitest';
import React from 'react';
import { vi } from 'vitest';
import { TextEncoder, TextDecoder } from 'util';

if (!globalThis.TextEncoder) globalThis.TextEncoder = TextEncoder;
if (!globalThis.TextDecoder) globalThis.TextDecoder = TextDecoder;
globalThis.jest = vi;

vi.mock('react-markdown', () => ({
  default: ({ children }) => React.createElement('div', { 'data-testid': 'react-markdown' }, children),
}));

vi.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }) => React.createElement('div', { 'data-testid': 'browser-router' }, children),
  Routes: ({ children }) => React.createElement(React.Fragment, null, children),
  Route: ({ element }) => element || null,
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children, to, ...rest }) => React.createElement('a', { href: to, ...rest }, children),
  NavLink: ({ children, to, className, end, ...rest }) => React.createElement(
    'a',
    {
      href: to,
      className: typeof className === 'function' ? className({ isActive: false }) : className,
      ...rest,
    },
    children,
  ),
}));

vi.mock('./components/ErrorBoundary', () => ({
  default: ({ children }) => React.createElement('div', { 'data-testid': 'error-boundary' }, children),
}));

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}
