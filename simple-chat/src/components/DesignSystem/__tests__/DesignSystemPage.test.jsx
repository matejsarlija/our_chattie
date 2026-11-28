import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DesignSystemPage from '../DesignSystemPage';

vi.mock('../../../lib/env', () => ({
  env: { apiUrl: '/api', analysisDetailSseEnabled: false },
}));

vi.mock('../../../hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { defaultScanDepth: 'balanced' },
    updateSettings: vi.fn(),
  }),
}));

describe('DesignSystemPage', () => {
  test('renders semantic tokens with copy-to-clipboard, legal primitives, and overlays', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<DesignSystemPage />);

    expect(screen.getByRole('heading', { name: 'Dizajn sustav i komponente' })).toBeInTheDocument();
    expect(screen.getByText('text-ink')).toBeInTheDocument();
    expect(screen.getByText('border-line-control')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kopiraj text-ink' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('text-ink');
      expect(screen.getByText('Kopirano')).toBeInTheDocument();
    });

    // Status vocabulary fallback + Callout action
    expect(screen.getByText('Nepoznat status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Otvori dokaz' })).toBeInTheDocument();

    // Legal-data primitives (CoverageCell, AmountCell, LifecycleTimeline disclosure)
    expect(screen.getByText('163')).toBeInTheDocument();
    expect(screen.getByText('nije završena')).toBeInTheDocument();
    expect(screen.getByText(/1\.245\.000,50\s*€/)).toBeInTheDocument();
    expect(screen.getByText('Primjer tijeka tražbine (LifecycleTimeline)')).toBeInTheDocument();

    // Dialog and Sheet overlay demos
    fireEvent.click(screen.getByRole('button', { name: 'Otvori Dialog modal' }));
    expect(screen.getByText('Primjer Dialog komponente')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zatvori dijalog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Otvori Sheet ladicu dokaza' }));
    expect(screen.getByText('Primjer Sheet ladice')).toBeInTheDocument();
  });
});
