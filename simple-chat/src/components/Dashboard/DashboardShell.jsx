import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DashboardHeader from './DashboardHeader';
import NewAnalysisModal from './NewAnalysisModal';
import SettingsPopover from './SettingsPopover';

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
    <div className="flex min-h-screen flex-col bg-bg">
      <DashboardHeader onOpenNewAnalysis={() => setIsNewModalOpen(true)} />
      <div className="flex-1">{children}</div>
      <div className="fixed bottom-4 right-4 z-40 print:hidden">
        <SettingsPopover />
      </div>
      <NewAnalysisModal isOpen={isNewModalOpen} onClose={() => setIsNewModalOpen(false)} />
    </div>
  );
}
