/**
 * @jest-environment jsdom
 */

import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Dialog from '../Dialog';

function DialogHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Otvori dijalog</button>
      <Dialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Postavke"
        description="Primjenjuju se na sljedeću analizu."
      >
        Sadržaj dijaloga
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  test('announces its title and description, closes with Escape, and restores focus', async () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Otvori dijalog' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Postavke' })).toHaveAccessibleDescription(
      'Primjenjuju se na sljedeću analizu.',
    );
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });
});
