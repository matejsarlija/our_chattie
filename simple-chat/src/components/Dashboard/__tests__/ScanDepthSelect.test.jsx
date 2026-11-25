/**
 * @jest-environment jsdom
 */

import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ScanDepthSelect from '../ScanDepthSelect';

function StatefulScanDepthSelect({ value: initialValue, onChange, ...props }) {
  const [value, setValue] = useState(initialValue);
  return (
    <ScanDepthSelect
      {...props}
      value={value}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

describe('ScanDepthSelect', () => {
  test('renders exactly the two depth options with balanced selected by default', () => {
    render(<ScanDepthSelect value="balanced" onChange={jest.fn()} />);

    const combo = screen.getByLabelText(/dubina pretrage/i);
    expect(combo).toHaveValue('balanced');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'Uravnoteženo' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sve' })).toBeInTheDocument();
    expect(screen.getByText(/100 objava/i)).toBeInTheDocument();
  });

  test('selecting an option emits and renders the depth value', () => {
    const onChange = jest.fn();
    render(<StatefulScanDepthSelect value="balanced" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/dubina pretrage/i), { target: { value: 'full' } });

    expect(onChange).toHaveBeenCalledWith('full');
    expect(screen.getByLabelText(/dubina pretrage/i)).toHaveValue('full');
    expect(screen.getByText('Sve dostupne objave.')).toBeInTheDocument();
  });

  test('falls back to balanced for an invalid value', () => {
    render(<ScanDepthSelect value="deep" onChange={jest.fn()} />);

    expect(screen.getByLabelText(/dubina pretrage/i)).toHaveValue('balanced');
    expect(screen.getByText(/najnovije i najstarije/i)).toBeInTheDocument();
  });

  test('does not emit when disabled', () => {
    const onChange = jest.fn();
    render(<ScanDepthSelect value="balanced" onChange={onChange} disabled />);

    const combo = screen.getByLabelText(/dubina pretrage/i);
    expect(combo).toBeDisabled();
    fireEvent.change(combo, { target: { value: 'full' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
