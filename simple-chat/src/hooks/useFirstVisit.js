import { useState, useEffect } from 'react';

export const useFirstVisit = () => {
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check localStorage to determine if this is first visit
    const hasVisited = localStorage.getItem('hasVisitedBefore') === 'true';
    
    if (!hasVisited) {
      setIsFirstVisit(true);
      // Set the flag in localStorage
      localStorage.setItem('hasVisitedBefore', 'true');
    }
    
    setLoading(false);
  }, []);

  return { isFirstVisit, loading };
};