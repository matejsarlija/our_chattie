import { render, screen, within } from '@testing-library/react';
import RunsTable from '../RunsTable';
import StatusBadge from '../../ui/StatusBadge';
import AmountCell from '../../ui/AmountCell';
import CoverageCell from '../../ui/CoverageCell';
import { formatRelative, formatCoverage } from '../../ui/format';

// Real-shaped run rows. `summary` is what the backend now projects at
// completion (backend/court-analysis/utils/runSummary.js).
const RUNS = [
  {
    id: 'r1',
    status: 'done',
    oib: '66124057408',
    created_at: '2026-09-13T15:40:00.000Z',
    summary: {
      caseNumber: 'St-2/2013',
      court: 'Trgovački sud u Splitu',
      participantNames: ['Kerum d.o.o. u stečaju'],
      participantOibs: ['66124057408'],
      queryType: 'oib',
      queryValue: '66124057408',
      coverage: { analyzed: 57, total: 63, failed: 6, coverageRatio: 0.9, groundedClaims: 5, totalClaims: 6 },
      amounts: { entryCount: 273, directionsPresent: ['obveza', 'potraživanje'], singleDirection: null, mixedDirections: true, eurTotal: 1685587973.69, largestClaimEur: 97173825.07, dualCurrencyMismatch: true },
    },
  },
  {
    id: 'r2',
    status: 'running',
    oib: '44556677889',
    created_at: '2026-09-29T15:38:00.000Z',
    summary: { caseNumber: 'Ovr-455/2023', queryType: 'oib', queryValue: '44556677889', coverage: null, amounts: null },
  },
  {
    // Legacy run: no summary at all, must degrade rather than crash.
    id: 'r3',
    status: 'error',
    oib: '66124057408',
    created_at: '2025-12-21T14:35:00.000Z',
  },
];

// setupTests.js already mocks react-router-dom globally, rendering Link as a
// real <a href>, which is exactly what these assertions need.
const renderTable = () => render(<RunsTable runs={RUNS} onOpenRun={() => {}} />);

describe('RunsTable', () => {
  test('renders a caption and a column header per column', () => {
    const { container } = renderTable();
    expect(container.querySelector('caption')).toBeTruthy();
    expect(container.querySelectorAll('th[scope="col"]')).toHaveLength(5);
  });

  test('uses a real link per row, not a focusable tr with role=button', () => {
    const { container } = renderTable();
    expect(container.querySelectorAll('tr[role="button"]')).toHaveLength(0);
    expect(container.querySelectorAll('tr[tabindex]')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /St-2\/2013/ })).toHaveAttribute('href', '/dashboard/runs/r1');
  });

  test('does not hide the row content behind an aria-label', () => {
    // The old <tr aria-label="Otvori analizu za OIB ..."> replaced the row's own
    // text, so a screen reader never heard the status or the date.
    const { container } = renderTable();
    expect(container.querySelector('tr[aria-label]')).toBeNull();
  });

  test('shows the case number, party and court for the Predmet cell', () => {
    renderTable();
    const link = screen.getByRole('link', { name: /St-2\/2013/ });
    expect(within(link).getByText('Kerum d.o.o. u stečaju · Trgovački sud u Splitu')).toBeTruthy();
  });

  test('renders a dash-safe row for a legacy run with no summary', () => {
    const { container } = renderTable();
    const row = container.querySelectorAll('tbody tr')[2];
    expect(within(row).getByText('Predmet bez broja')).toBeTruthy();
    expect(within(row).getByText('nije završena')).toBeTruthy();
  });
});

describe('StatusBadge — single vocabulary, fails loud', () => {
  test.each([
    ['done', 'Završeno'],
    ['completed', 'Završeno'],
    ['running', 'U tijeku'],
    ['queued', 'U redu čekanja'],
    ['canceled', 'Otkazano'],
    ['cancelled', 'Otkazano'],
    ['error', 'Greška'],
    ['failed', 'Greška'],
  ])('maps %s to the one Croatian label', (input, label) => {
    render(<StatusBadge status={input} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  test('an UNRECOGNISED status does not claim to be in progress', () => {
    // The old implementation's fallback mapped anything unknown to "U tijeku",
    // so a failed run could display as running.
    render(<StatusBadge status="teleported" />);
    expect(screen.getByText('Nepoznat status')).toBeTruthy();
    expect(screen.queryByText('U tijeku')).toBeNull();
  });

  test('carries state with a glyph, not colour alone (WCAG 1.4.1)', () => {
    const { container } = render(<StatusBadge status="error" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  // Option B: a uniform outlined frame. The frame is identical for every tone,
  // so the column never shouts; colour lives on the glyph only.
  test('uses one uniform frame for every tone (option B)', () => {
    const { container: done } = render(<StatusBadge status="done" />);
    const { container: error } = render(<StatusBadge status="error" />);
    const frameOf = (c) => c.querySelector('span').className;
    expect(frameOf(done)).toBe(frameOf(error));
    expect(frameOf(done)).toContain('rounded-full');
    expect(frameOf(done)).toContain('border-line');
  });

  test('the tone colour is on the glyph, not the frame', () => {
    const { container } = render(<StatusBadge status="error" />);
    const frame = container.querySelector('span');
    const glyph = frame.querySelector('span');
    expect(frame.className).not.toContain('text-danger');
    expect(glyph.className).toContain('text-danger');
  });

  test('a caller can override the frame radius via cn()', () => {
    const { container } = render(<StatusBadge status="done" className="rounded-sm" />);
    expect(container.querySelector('span').className).toContain('rounded-sm');
    expect(container.querySelector('span').className).not.toContain('rounded-full');
  });
});

describe('AmountCell — refuses to invent a total', () => {
  test('never renders the meaningless mixed-direction eurTotal', () => {
    // 1.685.587.973,69 EUR is the backend's sum across obveze, potraživanja,
    // namirenja and rejected claims. It must not reach a list row.
    render(<AmountCell amounts={RUNS[0].summary.amounts} />);
    expect(screen.queryByText(/1\.685\.587\.973/)).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });

  test('shows a total when every entry points the same way', () => {
    const { container } = render(<AmountCell amounts={{ entryCount: 2, directionsPresent: ['potraživanje'], singleDirection: 'potraživanje', eurTotal: 1500, mixedDirections: false }} />);
    expect(container.textContent).toMatch(/1\.500,00/);
    // A figure and nothing else — no direction sub-label.
    expect(container.textContent).not.toMatch(/potraživanja/);
  });

  // Option B: a figure or a dash. Never an explanation. The old copy rendered
  // "nema iznosa u EUR" for runs that actually held 96 moneyFlow entries, which
  // was an untrue statement, not just a noisy one.
  test('renders a bare dash and no justification when there is no figure', () => {
    const { container } = render(<AmountCell amounts={{ entryCount: 96, directionsPresent: [], singleDirection: null, mixedDirections: false }} running />);
    expect(container.textContent).toBe('—');
    expect(container.textContent).not.toMatch(/nema iznosa|računa se|mješovito/);
  });

  test('never states "no amount in EUR" for a run that found monetary entries', () => {
    const { container } = render(<AmountCell amounts={{ entryCount: 96, directionsPresent: [], singleDirection: null, mixedDirections: false }} />);
    expect(container.textContent).not.toMatch(/nema iznosa u EUR/);
  });
});

describe('CoverageCell — three distinct states', () => {
  test('complete coverage reads differently from a partial one', () => {
    const { rerender } = render(<CoverageCell coverage={{ analyzed: 18, total: 18, groundedClaims: 12, totalClaims: 12 }} />);
    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.getByText('12/12 navoda')).toBeTruthy();
    rerender(<CoverageCell coverage={{ analyzed: 57, total: 63, groundedClaims: 5, totalClaims: 6 }} />);
    expect(screen.getByText('5/6 navoda')).toBeTruthy();
  });

  test('an unfinished run says so rather than showing 0', () => {
    render(<CoverageCell coverage={null} status="error" />);
    expect(screen.getByText('nije završena')).toBeTruthy();
  });

  test('gives the meter an accessible name, not just a coloured bar', () => {
    render(<CoverageCell coverage={{ analyzed: 57, total: 63, groundedClaims: 5, totalClaims: 6 }} />);
    expect(screen.getByRole('img', { name: /Analizirano 57 od 63 dokumenata/ })).toBeTruthy();
  });
});

describe('formatRelative — Croatian', () => {
  const now = new Date('2026-09-30T12:00:00.000Z').getTime();
  test.each([
    ['2026-09-30T11:58:00.000Z', 'prije 2 min'],
    ['2026-09-30T09:00:00.000Z', 'prije 3 h'],
    ['2026-09-28T12:00:00.000Z', 'prije 2 dana'],
  ])('renders %s as "%s"', (iso, expected) => {
    expect(formatRelative(iso, now)).toBe(expected);
  });

  test('returns null for unparseable input rather than "NaN" on screen', () => {
    expect(formatRelative('nonsense', now)).toBeNull();
    expect(formatRelative(null, now)).toBeNull();
  });
});

describe('formatCoverage', () => {
  test('returns null when there are no figures, so callers can show a dash', () => {
    expect(formatCoverage(null)).toBeNull();
    expect(formatCoverage({})).toBeNull();
    expect(formatCoverage({ analyzed: 57, total: 63 })).toBe('57/63');
  });
});

describe('RunsTable — faithfulness to the approved prototype', () => {
  test('tints the in-flight row so a running case is findable', () => {
    const { container } = renderTable();
    const rows = container.querySelectorAll('tbody tr');
    expect(rows[1].className).toContain('bg-info-surface/25');
    expect(rows[0].className).not.toContain('bg-info-surface/25');
  });

  test('shows why an errored run failed, clamped to one line', () => {
    const runs = [{ id: 'e1', status: 'error', oib: '1', created_at: '2025-12-21T14:35:00.000Z', error: 'Prekinuto tijekom preuzimanja' }];
    const { container } = render(<RunsTable runs={runs} onOpenRun={() => {}} />);
    const cell = container.querySelector('tbody tr td:nth-child(3)');
    const note = within(cell).getByText('Prekinuto tijekom preuzimanja');
    expect(note.className).toContain('truncate');
    expect(note.className).toContain('max-w-[16rem]');
  });
});

describe('RunsTable — whole row is the click target', () => {
  test('the row itself is never made interactive', () => {
    // The regression we are avoiding: onClick + tabIndex + role="button" on a
    // <tr> makes rows focusable-but-invisible and wrecks table semantics.
    const { container } = renderTable();
    container.querySelectorAll('tbody tr').forEach((row) => {
      expect(row.getAttribute('tabindex')).toBeNull();
      expect(row.getAttribute('role')).toBeNull();
      expect(row.getAttribute('aria-label')).toBeNull();
    });
  });

  test('the real link is stretched over the whole row via an ::after overlay', () => {
    // jsdom does not hit-test pseudo-elements, so this asserts the mechanism
    // rather than simulating a click on a non-link cell.
    const { container } = renderTable();
    const row = container.querySelector('tbody tr');
    expect(row.className).toContain('relative');

    const link = within(row).getByRole('link');
    expect(link.className).toContain('after:absolute');
    expect(link.className).toContain('after:inset-0');
  });

  test('the focus ring is carried by the row, not the stretched link', () => {
    const { container } = renderTable();
    const row = container.querySelector('tbody tr');
    expect(row.className).toContain('focus-within:outline');
    expect(row.className).toContain('focus-within:outline-accent');

    // The link's own outline is suppressed, otherwise the ring appears twice
    // and the link's box is the wrong shape for a row-sized target.
    const link = within(row).getByRole('link');
    expect(link.className).toContain('focus-visible:outline-none');
  });
});

describe('RunsTable — header separation', () => {
  test('a rule sits below the column header band', () => {
    const { container } = renderTable();
    const headRow = container.querySelector('thead tr');
    expect(headRow.className).toContain('border-b');
    expect(headRow.className).toContain('border-line');
  });
});

describe('StatusBadge — the pill has room for its label', () => {
  // Regression: the shadcn adaptation dropped the upstream `px-2 py-0.5`
  // entirely, so the pill was bare text inside a 1px border and read as
  // "barely large enough for its content".
  test('carries real padding on both axes', () => {
    const { container } = render(<StatusBadge status="done" />);
    const cls = container.querySelector('span').className;
    expect(cls).toMatch(/px-2\.5/);
    expect(cls).toMatch(/py-1/);
  });

  test('the label is 13px, not the 11px micro-label size', () => {
    // The token spec reserves 11px for uppercase tracked micro-labels and says
    // it is never for content. A status word is content.
    const { container } = render(<StatusBadge status="done" />);
    const cls = container.querySelector('span').className;
    expect(cls).toMatch(/text-sm/);
    expect(cls).not.toMatch(/text-xs/);
  });

  test('no rendered text falls below the 11px legibility floor', () => {
    ['done', 'error', 'running', 'queued', 'canceled', 'nonsense'].forEach((status) => {
      const { container, unmount } = render(<StatusBadge status={status} />);
      container.querySelectorAll('*').forEach((el) => {
        if (el.textContent.trim() && !el.children.length) {
          expect(el.className).not.toMatch(/text-\[1[01]px\]|text-\[9px\]/);
        }
      });
      unmount();
    });
  });
});
