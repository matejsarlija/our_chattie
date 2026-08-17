import { useRef } from 'react';

const DEPTHS = ['standard', 'balanced', 'full'];

const LABELS = {
  standard: 'Standardno',
  balanced: 'Uravnoteženo',
  full: 'Sve dostupne',
};

const HELPERS = {
  standard: '5 stranica — najnovije objave',
  balanced: '5 stranica + 10 najstarijih objava',
  full: 'Sve dostupne objave predmeta',
};

// Dial geometry: balanced points up (0°), standard left (-90°), full right (+90°).
const ANGLES = { standard: -90, balanced: 0, full: 90 };

const CX = 60;
const CY = 60;
const KNOB_R = 44;
const ARC_R = 38;
const POINTER_START = 15;
const POINTER_END = 34;
const DEAD_ZONE = 10;

function polar(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  const sweep = endAngle > startAngle ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function nearestDetent(angle) {
  let best = DEPTHS[1];
  let bestDiff = Infinity;
  for (const depth of DEPTHS) {
    const diff = Math.abs(angle - ANGLES[depth]);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = depth;
    }
  }
  return best;
}

export default function DepthDial({ value = 'balanced', onChange, disabled = false }) {
  const draggingRef = useRef(false);

  const index = DEPTHS.includes(value) ? DEPTHS.indexOf(value) : 1;
  const angle = ANGLES[value] ?? 0;

  const select = (next) => {
    if (disabled || next === value || !DEPTHS.includes(next)) return;
    onChange?.(next);
  };

  const pointerAngle = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;
    if (Math.hypot(dx, dy) < DEAD_ZONE) return null;
    return (Math.atan2(dx, -dy) * 180) / Math.PI;
  };

  const handlePointerDown = (event) => {
    if (disabled) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const deg = pointerAngle(event);
    if (deg !== null) select(nearestDetent(deg));
  };

  const handlePointerMove = (event) => {
    if (!draggingRef.current || disabled) return;
    const deg = pointerAngle(event);
    if (deg !== null) select(nearestDetent(deg));
  };

  const handlePointerEnd = (event) => {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleKeyDown = (event) => {
    if (disabled) return;
    let nextIndex = null;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        nextIndex = Math.min(index + 1, 2);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        nextIndex = Math.max(index - 1, 0);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = 2;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(DEPTHS[nextIndex]);
  };

  return (
    <div className={`flex flex-col items-center gap-1.5 ${disabled ? 'opacity-60' : ''}`}>
      <div
        role="slider"
        aria-label="Dubina pretrage"
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={index}
        aria-valuetext={`${LABELS[value]} — ${HELPERS[value]}`}
        aria-orientation="vertical"
        tabIndex={disabled ? -1 : 0}
        className="cursor-grab rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleKeyDown}
      >
        <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx={CX} cy={CY} r={KNOB_R} fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
          <circle cx={CX} cy={CY} r="3.5" fill="var(--text-muted)" />

          <path d={arcPath(CX, CY, ARC_R, -90, 90)} fill="none" stroke="var(--border)" strokeWidth="4" strokeLinecap="round" />
          <path d={arcPath(CX, CY, ARC_R, -90, angle)} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />

          {DEPTHS.map((depth) => {
            const tickAngle = ANGLES[depth];
            const outer = polar(CX, CY, KNOB_R, tickAngle);
            const inner = polar(CX, CY, KNOB_R - 5, tickAngle);
            return (
              <line
                key={depth}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke={depth === value ? 'var(--accent)' : 'var(--text-muted)'}
                strokeWidth="2"
                strokeLinecap="round"
              />
            );
          })}

          <g transform={`rotate(${angle} ${CX} ${CY})`} style={{ transition: 'transform 120ms ease' }}>
            <line x1={CX} y1={CY - POINTER_START} x2={CX} y2={CY - POINTER_END} stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" />
          </g>
        </svg>
      </div>

      <div className="text-center leading-tight">
        <div className="text-sm font-semibold text-[var(--text)]">{LABELS[value]}</div>
        <div className="mt-0.5 text-xs text-[var(--text-muted)]">{HELPERS[value]}</div>
      </div>
    </div>
  );
}
