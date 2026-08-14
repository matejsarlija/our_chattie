/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import GeminiPlanToggle from '../GeminiPlanToggle';
import { useSettings } from '../../../hooks/useSettings';

jest.mock('../../../hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

describe('GeminiPlanToggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders both plan options with the free plan selected by default', () => {
    useSettings.mockReturnValue({
      geminiPlan: 'free',
      saving: false,
      error: '',
      saveGeminiPlan: jest.fn(),
    });

    render(<GeminiPlanToggle />);

    expect(screen.getByRole('radio', { name: 'Besplatni' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Plaćeni' }).getAttribute('aria-checked')).toBe('false');
  });

  test('marks the paid plan as selected when configured', () => {
    useSettings.mockReturnValue({
      geminiPlan: 'paid',
      saving: false,
      error: '',
      saveGeminiPlan: jest.fn(),
    });

    render(<GeminiPlanToggle />);

    expect(screen.getByRole('radio', { name: 'Plaćeni' }).getAttribute('aria-checked')).toBe('true');
  });

  test('saves the plan when the user selects a different option', async () => {
    const saveGeminiPlan = jest.fn().mockResolvedValue({ geminiPlan: 'paid' });
    useSettings.mockReturnValue({
      geminiPlan: 'free',
      saving: false,
      error: '',
      saveGeminiPlan,
    });

    render(<GeminiPlanToggle />);

    fireEvent.click(screen.getByRole('radio', { name: 'Plaćeni' }));

    await waitFor(() => {
      expect(saveGeminiPlan).toHaveBeenCalledWith('paid');
    });
  });

  test('does not save when the selected plan is clicked again', async () => {
    const saveGeminiPlan = jest.fn();
    useSettings.mockReturnValue({
      geminiPlan: 'free',
      saving: false,
      error: '',
      saveGeminiPlan,
    });

    render(<GeminiPlanToggle />);

    fireEvent.click(screen.getByRole('radio', { name: 'Besplatni' }));

    expect(saveGeminiPlan).not.toHaveBeenCalled();
  });

  test('surfaces a save error message', () => {
    useSettings.mockReturnValue({
      geminiPlan: 'free',
      saving: false,
      error: 'Neuspjelo spremanje postavki.',
      saveGeminiPlan: jest.fn(),
    });

    render(<GeminiPlanToggle />);

    expect(screen.getByText('Neuspjelo spremanje postavki.')).toBeInTheDocument();
  });
});
