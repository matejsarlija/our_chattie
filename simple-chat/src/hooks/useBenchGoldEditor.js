import { useCallback, useEffect, useState } from 'react';
import {
  getBenchGoldTemplate,
  listBenchGoldSets,
  saveBenchGoldTemplate,
  suggestBenchGold,
} from '../lib/apiClient';

export function useBenchGoldEditor() {
  const [sets, setSets] = useState([]);
  const [selectedSet, setSelectedSet] = useState('');
  const [selectedFile, setSelectedFile] = useState('');
  const [template, setTemplate] = useState(null);
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    listBenchGoldSets()
      .then((res) => {
        if (!active) return;
        const list = res?.sets || [];
        setSets(list);
        if (list[0]?.documents?.[0]) {
          setSelectedSet(list[0].setId);
          setSelectedFile(list[0].documents[0].file);
        }
      })
      .catch((err) => active && setError(err.message || 'Greška pri učitavanju Gold skupova.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const loadTemplate = useCallback(async (setId, file) => {
    if (!setId || !file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getBenchGoldTemplate(setId, file);
      setTemplate(res?.template || null);
      setSummary(res?.summary || null);
      setPage(1);
    } catch (err) {
      setError(err.message || 'Greška pri učitavanju Gold predloška.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSet && selectedFile) {
      loadTemplate(selectedSet, selectedFile);
    }
  }, [selectedSet, selectedFile, loadTemplate]);

  const saveTemplate = useCallback(async ({ facts, factsComplete, reviewedCategories }) => {
    setSaving(true);
    setError(null);
    try {
      const res = await saveBenchGoldTemplate({
        set: selectedSet,
        file: selectedFile,
        facts,
        factsComplete,
        reviewedCategories,
      });
      setSummary(res?.summary || null);
      await loadTemplate(selectedSet, selectedFile);
      return res;
    } catch (err) {
      setError(err.message || 'Spremanje Gold predloška nije uspjelo.');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [selectedSet, selectedFile, loadTemplate]);

  const requestSuggestion = useCallback(async (model) => {
    setError(null);
    return suggestBenchGold({
      set: selectedSet,
      file: selectedFile,
      model,
      approved: true,
    });
  }, [selectedSet, selectedFile]);

  return {
    sets,
    selectedSet,
    setSelectedSet,
    selectedFile,
    setSelectedFile,
    template,
    summary,
    page,
    setPage,
    loading,
    saving,
    error,
    saveTemplate,
    requestSuggestion,
  };
}
