/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DepthDial from '../DepthDial';

beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      constructor(type, init = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    window.PointerEvent = PointerEventPolyfill;
  }
});

const rect120 = { left: 0, top: 0, width: 120, height: 120, right: 120, bottom: 120 };

describe('DepthDial', () => {
  test('renders the balanced default with an informative ARIA value text', () => {
    render(<DepthDial value="balanced" onChange={jest.fn()} />);
    const slider = screen.getByRole('slider');

    expect(slider).toHaveAttribute('aria-valuenow', '1');
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '2');
    expect(slider).toHaveAttribute('aria-orientation', 'vertical');
    expect(slider).toHaveAttribute('aria-valuetext', 'Uravnoteženo — 5 stranica + 10 najstarijih objava');
    expect(screen.getByText('Uravnoteženo')).toBeInTheDocument();
  });

  test('keyboard advances and retreats across detents', () => {
    const onChange = jest.fn();
    render(<DepthDial value="balanced" onChange={onChange} />);
    const slider = screen.getByRole('slider');

    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('full');

    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('standard');
  });

  test('Home and End jump to the extremes', () => {
    const onChange = jest.fn();
    render(<DepthDial value="balanced" onChange={onChange} />);
    const slider = screen.getByRole('slider');

    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('standard');

    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('full');
  });

  test('click-hold and rotate follows the pointer angle', () => {
    const onChange = jest.fn();
    render(<DepthDial value="balanced" onChange={onChange} />);
    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () => rect120;

    // Grab near the top (balanced) — no change yet.
    fireEvent.pointerDown(slider, { clientX: 60, clientY: 20, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();

    // Rotate to the right -> full.
    fireEvent.pointerMove(slider, { clientX: 160, clientY: 60, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith('full');

    fireEvent.pointerUp(slider, { pointerId: 1 });
  });

  test('clicking a detent position selects it directly', () => {
    const onChange = jest.fn();
    render(<DepthDial value="balanced" onChange={onChange} />);
    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () => rect120;

    // Left of center -> standard.
    fireEvent.pointerDown(slider, { clientX: 0, clientY: 60, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith('standard');

    fireEvent.pointerUp(slider, { pointerId: 1 });
  });

  test('does not emit when disabled', () => {
    const onChange = jest.fn();
    render(<DepthDial value="balanced" onChange={onChange} disabled />);
    const slider = screen.getByRole('slider');

    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(onChange).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute('tabindex', '-1');
  });
});
