import { render, screen, fireEvent } from '@testing-library/react';
import LifecycleTimeline from '../LifecycleTimeline';

const STAGE = (id, date, eventType, value, extra = {}) => ({
  id, date, eventType, value, valueRole: 'claim_balance', currency: 'EUR', fileName: 'Podnesak.pdf', ...extra,
});

describe('LifecycleTimeline', () => {
  test('renders nothing without value changes', () => {
    const { rerender } = render(<LifecycleTimeline valueChanges={[]} />);
    expect(screen.queryByTestId('lifecycle-timeline')).not.toBeInTheDocument();
    rerender(<LifecycleTimeline valueChanges={null} />);
    expect(screen.queryByTestId('lifecycle-timeline')).not.toBeInTheDocument();
  });

  // The claim overview uses neutral, record-based labels.
  test('leads with the claim position: original, latest, delta and percentage', () => {
    render(<LifecycleTimeline valueChanges={[{
      description: 'Tražbina Zagrebačke banke d.d.',
      linkage: 'claimRegistryNumber',
      originalValue: 27888441.11, latestValue: 763261.13,
      delta: -27125179.98, discountPct: -97.26, comparisonStatus: 'comparable',
      stages: [
        STAGE('a', '2019-05-03', 'prijava', 27888441.11),
        STAGE('b', '2022-07-12', 'namirenje', 763261.13),
      ],
    }]} />);

    expect(screen.getByText('Prijavljeni izvorni iznos')).toBeInTheDocument();
    expect(screen.getByText('Kasnije zabilježeni iznos')).toBeInTheDocument();
    expect(screen.getByText('Razlika prema izvješću')).toBeInTheDocument();
    expect(screen.getByText(/97,26/)).toBeInTheDocument();
    expect(screen.getByText('povezano rednim brojem')).toBeInTheDocument();
  });

  // 15 records of one assignment must never be labelled 15 transfers.
  test('states source-record and grouping counts without asserting duplicate events', () => {
    render(<LifecycleTimeline valueChanges={[{
      originalValue: 100, latestValue: 100, delta: 0, discountPct: 0, comparisonStatus: 'comparable',
      stages: [
        STAGE('p', '2019-05-03', 'prijava', 100, { transferee: 'Banka d.d.' }),
        ...Array.from({ length: 15 }, (_, i) =>
          STAGE(`r-${i}`, '2019-09-27', 'ustup', 100, { transferor: 'Banka d.d.', transferee: 'DDM INVEST III AG' })),
      ],
    }]} />);

    expect(screen.getByText(/16 izvornih zapisa · 2 prikazane grupe/)).toBeInTheDocument();
    expect(screen.getByText(/broj zapisa nije broj pravnih događaja/)).toBeInTheDocument();
    expect(screen.queryByText(/vjerojatno su dvostruko izvođenje/)).not.toBeInTheDocument();
    expect(screen.getByText('Izvorni zapisi · 15')).toBeInTheDocument();
    expect(screen.queryByText(/15 (odvojenih )?(ustupa|transfera)/i)).not.toBeInTheDocument();
  });

  test('normalizes date formats for grouped events and preserves non-EUR figures', () => {
    render(<LifecycleTimeline valueChanges={[{
      currency: 'HRK', originalValue: 753.45, latestValue: 753.45, delta: 0, comparisonStatus: 'comparable',
      stages: [
        STAGE('iso', '2020-02-01', 'ustup', 753.45, { currency: 'HRK', transferor: 'A', transferee: 'B' }),
        STAGE('cro', '01.02.2020.', 'ustup', 753.45, { currency: 'HRK', transferor: 'A', transferee: 'B' }),
      ],
    }]} />);

    expect(screen.queryByText('Datum se razlikuje među zapisima ove grupe.')).not.toBeInTheDocument();
    expect(screen.getAllByText(/753,45 HRK/)).toHaveLength(5);
  });

  test('distinguishes a creditor transfer from a change in reported amounts', () => {
    render(<LifecycleTimeline valueChanges={[{
      originalValue: 100, latestValue: 50, delta: -50, discountPct: -50, comparisonStatus: 'comparable',
      stages: [
        STAGE('a', '2020-01-01', 'prijava', 100),
        STAGE('b', '2020-02-01', 'ustup', 100, { transferor: 'A', transferee: 'B' }),
        STAGE('c', '2020-03-01', 'ustup', 50, { transferor: 'B', transferee: 'C' }),
      ],
    }]} />);

    const text = screen.getByTestId('lifecycle-timeline').textContent.replace(/\s+/g, ' ');
    expect(text).toContain('Promjena vjerovnika. Ustup sam po sebi ne potvrđuje promjenu iznosa duga.');
    expect(text).toMatch(/50,00\s*€/);
    expect(text).not.toContain('iznos se mijenja');
  });

  // Collapsing must never lose a record.
  test('expanding a collapsed row reveals every original stage', () => {
    render(<LifecycleTimeline valueChanges={[{
      originalValue: 100, latestValue: 100, delta: 0,
      stages: [
        STAGE('p', '2020-01-01', 'prijava', 100),
        ...Array.from({ length: 12 }, (_, i) =>
          STAGE(`x-${i}`, '2020-02-01', 'ustup', 100, { transferor: 'A', transferee: 'B', fileName: `Podnesak-${i}.pdf` })),
      ],
    }]} />);

    expect(screen.getByText('Izvorni zapisi · 12')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Izvorni zapisi · 12'));
    expect(screen.getByText('Prikaz 1–10 od 12 zapisa')).toBeInTheDocument();
    for (let i = 0; i < 10; i += 1) {
      expect(screen.getByText(`Podnesak-${i}.pdf`)).toBeInTheDocument();
    }
    expect(screen.queryByText('Podnesak-10.pdf')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Sljedeća'));
    expect(screen.getByText('Prikaz 11–12 od 12 zapisa')).toBeInTheDocument();
    expect(screen.getByText('Podnesak-10.pdf')).toBeInTheDocument();
    expect(screen.getByText('Podnesak-11.pdf')).toBeInTheDocument();
  });

  // A single-record row has nothing to expand, so its source must be visible.
  test('paginates long event ledgers without dropping event groups', () => {
    render(<LifecycleTimeline valueChanges={[{
      stages: Array.from({ length: 12 }, (_, index) =>
        STAGE(`event-${index}`, `2020-01-${String(index + 1).padStart(2, '0')}`, 'prijava', index + 1)),
    }]} />);

    expect(screen.getAllByText('Prijava')).toHaveLength(10);
    expect(screen.getByText('Prikaz 1–10 od 12 grupa')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sljedeća'));
    expect(screen.getAllByText('Prijava')).toHaveLength(2);
    expect(screen.getByText('Prikaz 11–12 od 12 grupa')).toBeInTheDocument();
  });

  test('a single-record row still shows its source filing', () => {
    render(<LifecycleTimeline valueChanges={[{
      originalValue: 100, latestValue: 100,
      stages: [STAGE('only', '2020-01-01', 'prijava', 100, { fileName: 'Rjesenje_o_otvaranju.pdf' })],
    }]} />);
    expect(screen.getAllByText('Rjesenje_o_otvaranju.pdf')).toHaveLength(2);
  });

  test('explains why no balance comparison was computed and links the source records', () => {
    render(<LifecycleTimeline
      valueChanges={[{
        originalValue: 27888441.11,
        latestValue: 763261.13,
        delta: -27125179.98,
        discountPct: -97.26,
        stages: [
          STAGE('claim', '2019-05-03', 'prijava', 27888441.11, { valueRole: undefined, sourceId: 'doc-1', fileName: 'Prijava.pdf' }),
          STAGE('payment', '2022-07-12', 'namirenje', 763261.13, { valueRole: undefined, sourceId: 'doc-2', fileName: 'Namirenje.pdf' }),
        ],
      }]}
      sourceDocuments={[
        { id: 'doc-1', fileName: 'Prijava.pdf', url: 'https://court.example.test/prijava.pdf' },
        { id: 'doc-2', fileName: 'Namirenje.pdf', url: 'javascript:alert(1)' },
      ]}
    />);

    expect(screen.queryByText('Razlika prema izvješću')).not.toBeInTheDocument();
    expect(screen.queryByText(/97,26/)).not.toBeInTheDocument();
    expect(screen.getByTestId('claim-balance-not-compared')).toHaveTextContent(/Saldo nije izračunat/);
    expect(screen.getByTestId('claim-balance-not-compared')).toHaveTextContent(/0 od 2 prikazanih iznosa/);
    expect(screen.getByRole('link', { name: 'Prijava.pdf' })).toHaveAttribute('href', 'https://court.example.test/prijava.pdf');
    expect(screen.queryByRole('link', { name: 'Namirenje.pdf' })).not.toBeInTheDocument();
  });

  test('says plainly when an event records no amount', () => {
    render(<LifecycleTimeline valueChanges={[{
      originalValue: 100, latestValue: 100,
      stages: [STAGE('n', '2025-07-18', 'namirenje', null)],
    }]} />);
    expect(screen.getByText('Nije navedeno')).toBeInTheDocument();
  });

  test('keeps records with no date in a separate disclosure', () => {
    render(<LifecycleTimeline valueChanges={[{
      stages: [STAGE('undated', '', 'ustup', 100, { transferor: 'A', transferee: 'B' })],
    }]} />);

    expect(screen.getByText('Datum nije utvrđen · 1 izvorni zapis')).toBeInTheDocument();
    expect(screen.getByText('Ovi zapisi nisu umetnuti u kronologiju jer datum nije dostupan. Redoslijed i povezanost provjerite u izvorima.')).toBeInTheDocument();
  });

  test('falls back to `finding` for pre-migration entries with no stages', () => {
    render(<LifecycleTimeline valueChanges={[{
      description: 'Tražbina', finding: 'Tražbina ustupljena je za 15.000,00 EUR.',
    }]} />);
    expect(screen.getByText(/Tražbina ustupljena je za 15.000,00 EUR\./)).toBeInTheDocument();
  });
});
