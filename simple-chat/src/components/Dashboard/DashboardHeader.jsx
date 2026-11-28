import { Link, NavLink, useNavigate } from 'react-router-dom';
import Button from '../ui/Button';
import { cn } from '../../lib/utils';

const navLinkClass = ({ isActive }) => cn(
  'rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
  isActive
    ? 'bg-surface-muted text-ink'
    : 'text-ink-muted hover:bg-surface-muted/60 hover:text-ink',
);

export default function DashboardHeader({ onOpenNewAnalysis }) {
  const navigate = useNavigate();

  const handleNewAnalysis = () => {
    if (onOpenNewAnalysis) {
      onOpenNewAnalysis();
      return;
    }
    navigate('/dashboard?new=1');
  };

  return (
    <header className="border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
        <div className="flex items-center gap-6">
          <div className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
            <Link to="/dashboard" className="hover:text-accent transition-colors">
              Pravni Asistent
            </Link>
          </div>

          <nav aria-label="Glavna navigacija" className="hidden lg:flex items-center gap-1">
            <NavLink to="/dashboard" end className={navLinkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/dashboard/bench" className={navLinkClass}>
              Bench
            </NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={handleNewAnalysis}>
            + Nova analiza
          </Button>
        </div>
      </div>

      <nav
        aria-label="Mobilna navigacija"
        className="flex items-center gap-1 border-t border-line px-4 py-1.5 lg:hidden"
      >
        <NavLink to="/dashboard" end className={navLinkClass}>
          Dashboard
        </NavLink>
        <NavLink to="/dashboard/bench" className={navLinkClass}>
          Bench
        </NavLink>
      </nav>
    </header>
  );
}
