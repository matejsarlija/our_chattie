import React, { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { useStreamingAPI } from '../useStreamingAPI';

jest.unmock('../useStreamingAPI');

const createMockReader = (chunks) => {
  let index = 0;
  return {
    read: jest.fn(() => {
      if (index >= chunks.length) {
        return Promise.resolve({ done: true, value: undefined });
      }
      const value = new TextEncoder().encode(chunks[index]);
      index += 1;
      return Promise.resolve({ done: false, value });
    }),
  };
};

describe('useStreamingAPI document-edit stream', () => {
  test('streams content and completes on done event', async () => {
    const chunks = [
      'data: {"content":"Hello"}\n\n',
      'data: {"content":" world"}\n\n',
      'data: {"done": true, "mode": "preview"}\n\n',
    ];

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        body: {
          getReader: () => createMockReader(chunks),
        },
      })
    );

    const onContent = jest.fn();
    const onComplete = jest.fn();
    const onError = jest.fn();

    function TestHarness() {
      const api = useStreamingAPI();

      useEffect(() => {
        api.streamDocumentEdit(
          'Test content',
          'Make formal',
          { onContent, onComplete, onError },
          { mode: 'preview' }
        );
      }, [api]);

      return null;
    }

    render(<TestHarness />);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });

    expect(onContent).toHaveBeenCalledWith('Hello world', expect.any(Object));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ done: true, mode: 'preview' }));
    expect(onError).not.toHaveBeenCalled();
  });
});
