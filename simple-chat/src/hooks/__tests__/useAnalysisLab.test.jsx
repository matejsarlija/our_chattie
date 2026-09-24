/**
 * @jest-environment jsdom
 */

import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useLabPackages } from '../useLabPackages';
import { useLabExperiments } from '../useLabExperiments';
import { useLabExperimentDetail } from '../useLabExperimentDetail';
import { useCreateLabExperiment } from '../useCreateLabExperiment';
import {
  listLabPackages,
  listLabExperiments,
  getLabExperiment,
  createLabExperiment,
} from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({
  listLabPackages: jest.fn(),
  listLabExperiments: jest.fn(),
  getLabExperiment: jest.fn(),
  createLabExperiment: jest.fn(),
}));

function Harness({ hook, hookArgs, onValue }) {
  const value = hook(...hookArgs);
  useEffect(() => {
    onValue(value);
  }, [value, onValue]);
  return null;
}

describe('analysis lab hooks (LU-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('useLabPackages loads package list', async () => {
    const snapshots = [];
    listLabPackages.mockResolvedValue({
      packages: [{ ref: 'kerum-lab', kind: 'fixture', inputSummary: { caseNumber: 'St-2/2013', documents: 3 } }],
      count: 1,
    });

    render(<Harness hook={useLabPackages} hookArgs={[{}]} onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(listLabPackages).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].packages).toHaveLength(1);
    });
    expect(snapshots[snapshots.length - 1]).toMatchObject({ count: 1, loading: false, error: '' });
  });

  test('useLabPackages surfaces load errors with retry', async () => {
    const snapshots = [];
    listLabPackages.mockRejectedValueOnce(new Error('Mrežna greška.'));

    render(<Harness hook={useLabPackages} hookArgs={[{}]} onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].error).toBe('Mrežna greška.');
    });
    expect(snapshots[snapshots.length - 1].packages).toEqual([]);
  });

  test('useLabExperiments paginates like the run list', async () => {
    const snapshots = [];
    listLabExperiments
      .mockResolvedValueOnce({ experiments: [{ id: 'e1' }, { id: 'e2' }], count: 3, offset: 0 })
      .mockResolvedValueOnce({ experiments: [{ id: 'e3' }], count: 3, offset: 2 });

    render(<Harness hook={useLabExperiments} hookArgs={[{ limit: 2 }]} onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(listLabExperiments).toHaveBeenCalledWith({ limit: 2, offset: 0 });
    });
    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].experiments).toHaveLength(2);
    });

    await act(async () => {
      await snapshots[snapshots.length - 1].nextPage();
    });

    await waitFor(() => {
      expect(listLabExperiments).toHaveBeenCalledWith({ limit: 2, offset: 2 });
    });
    await waitFor(() => {
      expect(snapshots[snapshots.length - 1]).toMatchObject({
        offset: 2,
        experiments: [{ id: 'e3' }],
        hasPrev: true,
        hasNext: false,
        loading: false,
      });
    });
    expect(listLabExperiments).toHaveBeenCalledTimes(2);
  });

  test('useLabExperimentDetail loads the full record with comparison', async () => {
    const snapshots = [];
    getLabExperiment.mockResolvedValue({
      experiment: { id: 'e1', status: 'partial', variants: {} },
      comparison: { inputHashMatches: true },
    });

    render(<Harness hook={useLabExperimentDetail} hookArgs={['e1', {}]} onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(getLabExperiment).toHaveBeenCalledWith('e1');
    });
    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].experiment).toMatchObject({ id: 'e1', status: 'partial' });
    });
    expect(snapshots[snapshots.length - 1].comparison).toMatchObject({ inputHashMatches: true });
  });

  test('useLabExperimentDetail reports missing experiments', async () => {
    const snapshots = [];
    getLabExperiment.mockRejectedValueOnce(new Error('Analysis Lab experiment not found.'));

    render(<Harness hook={useLabExperimentDetail} hookArgs={['missing', {}]} onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].error).toMatch(/not found/);
    });
    expect(snapshots[snapshots.length - 1].experiment).toBeNull();
  });

  test('useCreateLabExperiment creates and reports creation errors', async () => {
    const snapshots = [];
    createLabExperiment.mockResolvedValueOnce({ experiment: { id: 'e9', status: 'complete' } });

    render(<Harness hook={useCreateLabExperiment} hookArgs={[]} onValue={(v) => snapshots.push(v)} />);

    let result;
    await act(async () => {
      result = await snapshots[snapshots.length - 1].createExperiment({ evidencePackageRef: 'kerum-lab' });
    });

    expect(createLabExperiment).toHaveBeenCalledWith({ evidencePackageRef: 'kerum-lab' });
    expect(result).toMatchObject({ experiment: { id: 'e9' } });

    createLabExperiment.mockRejectedValueOnce(new Error('Previše zahtjeva.'));
    await act(async () => {
      await snapshots[snapshots.length - 1].createExperiment({ evidencePackageRef: 'kerum-lab' });
    });
    expect(snapshots[snapshots.length - 1].createError).toBe('Previše zahtjeva.');
  });

  test('useCreateLabExperiment requires a package before calling the API', async () => {
    const snapshots = [];
    render(<Harness hook={useCreateLabExperiment} hookArgs={[]} onValue={(v) => snapshots.push(v)} />);

    await act(async () => {
      await snapshots[snapshots.length - 1].createExperiment({ evidencePackageRef: '' });
    });

    expect(createLabExperiment).not.toHaveBeenCalled();
    expect(snapshots[snapshots.length - 1].createError).toMatch(/paket/);
  });
});
