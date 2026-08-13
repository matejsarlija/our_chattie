import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DashboardHeader from './DashboardHeader';
import NewAnalysisModal from './NewAnalysisModal';

export default function DashboardShell({ children }) {
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setIsNewModalOpen(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <DashboardHeader onOpenNewAnalysis={() => setIsNewModalOpen(true)} />
      {children}
      <NewAnalysisModal isOpen={isNewModalOpen} onClose={() => setIsNewModalOpen(false)} />
    </div>
  );
}
