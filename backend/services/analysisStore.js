async function createAnalysisRun({ supabase, userId, oib, status = 'running' }) {
  const { data, error } = await supabase
    .from('analysis_runs')
    .insert({
      user_id: userId,
      oib,
      status,
      result_format: 'markdown',
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create analysis run: ${error.message}`);
  }

  return data;
}

async function appendAnalysisEvent({ supabase, analysisId, eventType, message, metadata }) {
  const payload = {
    analysis_id: analysisId,
    event_type: eventType,
    message,
    metadata: metadata || {},
  };

  const { error } = await supabase
    .from('analysis_events')
    .insert(payload);

  if (error) {
    throw new Error(`Failed to write analysis event: ${error.message}`);
  }
}

async function completeAnalysisRun({ supabase, analysisId, resultText }) {
  const { error } = await supabase
    .from('analysis_runs')
    .update({
      status: 'done',
      result_text: resultText,
      result_format: 'markdown',
      completed_at: new Date().toISOString(),
    })
    .eq('id', analysisId);

  if (error) {
    throw new Error(`Failed to complete analysis run: ${error.message}`);
  }
}

async function failAnalysisRun({ supabase, analysisId, errorMessage }) {
  const { error } = await supabase
    .from('analysis_runs')
    .update({
      status: 'error',
      error: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', analysisId);

  if (error) {
    throw new Error(`Failed to mark analysis run error: ${error.message}`);
  }
}

async function listAnalysisRuns({ supabase, limit, offset }) {
  const { data, error, count } = await supabase
    .from('analysis_runs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to list analysis runs: ${error.message}`);
  }

  return { data, count };
}

async function getAnalysisRun({ supabase, id }) {
  const { data, error } = await supabase
    .from('analysis_runs')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    throw new Error(`Analysis run not found: ${error.message}`);
  }

  return data;
}

async function getAnalysisEvents({ supabase, analysisId }) {
  const { data, error } = await supabase
    .from('analysis_events')
    .select('*')
    .eq('analysis_id', analysisId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load analysis events: ${error.message}`);
  }

  return data;
}

module.exports = {
  createAnalysisRun,
  appendAnalysisEvent,
  completeAnalysisRun,
  failAnalysisRun,
  listAnalysisRuns,
  getAnalysisRun,
  getAnalysisEvents,
};
