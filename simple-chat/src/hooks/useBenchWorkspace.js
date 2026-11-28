import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelBenchJob,
  getSettings,
  launchBenchRun,
  listBenchCandidates,
  listBenchDocuments,
  listBenchModels,
  listBenchRuns,
  resolveApiUrl,
  runCandidateMicroBench,
  runGbenchGate,
  seedBenchCandidates,
  updateSettings,
} from '../lib/apiClient';

export function useBenchWorkspace() {
  const [documents, setDocuments] = useState([]);
  const [smokeDocIds, setSmokeDocIds] = useState([]);
  const [models, setModels] = useState([]);
  const [runs, setRuns] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState(null);
  const [jobLogs, setJobLogs] = useState([]);
  const [jobStatus, setJobStatus] = useState(null);
  const [routingOverrides, setRoutingOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const streamRef = useRef(null);

  const attachJobStream = useCallback((jobId) => {
    if (!jobId) return;
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
    setActiveJobId(jobId);
    setJobStatus('running');
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(resolveApiUrl(`/api/bench/jobs/${encodeURIComponent(jobId)}/stream`));
    streamRef.current = es;

    es.addEventListener('job.progress', (ev) => {
      try {
        setJobProgress(JSON.parse(ev.data));
      } catch {
        // Ignore malformed frame.
      }
    });
    es.addEventListener('job.log', (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed?.line) setJobLogs((prev) => [...prev.slice(-99), parsed.line]);
      } catch {
        // Ignore malformed frame.
      }
    });
    es.addEventListener('job.done', () => {
      setJobStatus('done');
      setActiveJobId(null);
      es.close();
      streamRef.current = null;
      listBenchRuns().then((res) => setRuns(res?.runs || [])).catch(() => {});
    });
    es.addEventListener('job.error', (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        setJobStatus(parsed?.canceled ? 'canceled' : 'failed');
      } catch {
        setJobStatus('failed');
      }
      setActiveJobId(null);
      es.close();
      streamRef.current = null;
    });
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docsRes, modelsRes, runsRes, candRes, settingsRes] = await Promise.all([
        listBenchDocuments(),
        listBenchModels(),
        listBenchRuns(),
        listBenchCandidates(),
        getSettings().catch(() => ({ settings: {} })),
      ]);
      setDocuments(docsRes?.documents || []);
      setSmokeDocIds(docsRes?.smokeDocIds || []);
      setModels(modelsRes?.models || []);
      setRuns(runsRes?.runs || []);
      setCandidates(candRes?.candidates || []);
      setRoutingOverrides(settingsRes?.settings?.activeTaskRoutingOverrides || {});
      if (runsRes?.activeJobId) {
        attachJobStream(runsRes.activeJobId);
      }
    } catch (err) {
      setError(err.message || 'Greška pri učitavanju Bench radnog prostora.');
    } finally {
      setLoading(false);
    }
  }, [attachJobStream]);

  useEffect(() => {
    reload();
    return () => {
      if (streamRef.current) {
        streamRef.current.close();
        streamRef.current = null;
      }
    };
  }, [reload]);

  const startRun = useCallback(async (payload) => {
    setError(null);
    try {
      const res = await launchBenchRun(payload);
      setJobLogs([]);
      attachJobStream(res.jobId);
      return res;
    } catch (err) {
      if (err.status === 409 && err.data?.activeJobId) {
        attachJobStream(err.data.activeJobId);
        setError(`Aktivan posao već radi (${err.data.activeJobId}) — spojeno na postojeći tijek.`);
        return { jobId: err.data.activeJobId, reattached: true };
      }
      setError(err.message || 'Pokretanje nije uspjelo.');
      throw err;
    }
  }, [attachJobStream]);

  const cancelActiveJob = useCallback(async () => {
    if (!activeJobId) return;
    await cancelBenchJob(activeJobId);
    setJobStatus('canceled');
    setActiveJobId(null);
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
  }, [activeJobId]);

  const seedCandidates = useCallback(async () => {
    const res = await seedBenchCandidates();
    setCandidates(res?.candidates || []);
    return res;
  }, []);

  const microBenchCandidate = useCallback(async (id, payload) => {
    const res = await runCandidateMicroBench(id, payload);
    const updated = await listBenchCandidates();
    setCandidates(updated?.candidates || []);
    return res;
  }, []);

  const saveRoutingOverrides = useCallback(async (nextOverrides) => {
    const res = await updateSettings({ activeTaskRoutingOverrides: nextOverrides });
    setRoutingOverrides(res?.settings?.activeTaskRoutingOverrides || nextOverrides);
    return res;
  }, []);

  const triggerSmokeGate = useCallback(async (payload) => {
    const res = await runGbenchGate(payload);
    const modelsRes = await listBenchModels();
    setModels(modelsRes?.models || []);
    return res;
  }, []);

  return {
    documents,
    smokeDocIds,
    models,
    runs,
    candidates,
    activeJobId,
    jobProgress,
    jobLogs,
    jobStatus,
    routingOverrides,
    loading,
    error,
    reload,
    startRun,
    cancelActiveJob,
    seedCandidates,
    microBenchCandidate,
    saveRoutingOverrides,
    triggerSmokeGate,
  };
}
