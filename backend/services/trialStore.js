async function countTrialRuns({ supabaseAdmin, trialId }) {
  const { count, error } = await supabaseAdmin
    .from('trial_runs')
    .select('id', { count: 'exact', head: true })
    .eq('trial_id', trialId);

  if (error) {
    throw new Error(`Failed to count trial runs: ${error.message}`);
  }

  return count || 0;
}

async function createTrialRun({ supabaseAdmin, trialId, oib, status = 'running' }) {
  const { data, error } = await supabaseAdmin
    .from('trial_runs')
    .insert({
      trial_id: trialId,
      oib,
      status,
      result_format: 'markdown',
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create trial run: ${error.message}`);
  }

  return data;
}

async function appendTrialEvent({ supabaseAdmin, trialRunId, eventType, message, metadata }) {
  const payload = {
    trial_run_id: trialRunId,
    event_type: eventType,
    message,
    metadata: metadata || {},
  };

  const { error } = await supabaseAdmin
    .from('trial_events')
    .insert(payload);

  if (error) {
    throw new Error(`Failed to write trial event: ${error.message}`);
  }
}

async function completeTrialRun({ supabaseAdmin, trialRunId, resultText }) {
  const { error } = await supabaseAdmin
    .from('trial_runs')
    .update({
      status: 'done',
      result_text: resultText,
      result_format: 'markdown',
      completed_at: new Date().toISOString(),
    })
    .eq('id', trialRunId);

  if (error) {
    throw new Error(`Failed to complete trial run: ${error.message}`);
  }
}

async function failTrialRun({ supabaseAdmin, trialRunId, errorMessage }) {
  const { error } = await supabaseAdmin
    .from('trial_runs')
    .update({
      status: 'error',
      error: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', trialRunId);

  if (error) {
    throw new Error(`Failed to mark trial run error: ${error.message}`);
  }
}

async function getTrialRuns({ supabaseAdmin, trialId }) {
  const { data, error } = await supabaseAdmin
    .from('trial_runs')
    .select('*')
    .eq('trial_id', trialId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load trial runs: ${error.message}`);
  }

  return data || [];
}

async function getTrialEvents({ supabaseAdmin, trialRunId }) {
  const { data, error } = await supabaseAdmin
    .from('trial_events')
    .select('*')
    .eq('trial_run_id', trialRunId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load trial events: ${error.message}`);
  }

  return data || [];
}

async function deleteTrialData({ supabaseAdmin, trialId }) {
  const { data: runs, error } = await supabaseAdmin
    .from('trial_runs')
    .select('id')
    .eq('trial_id', trialId);

  if (error) {
    throw new Error(`Failed to load trial runs for delete: ${error.message}`);
  }

  const runIds = (runs || []).map((run) => run.id);
  if (runIds.length > 0) {
    const { error: eventsError } = await supabaseAdmin
      .from('trial_events')
      .delete()
      .in('trial_run_id', runIds);

    if (eventsError) {
      throw new Error(`Failed to delete trial events: ${eventsError.message}`);
    }
  }

  const { error: runsError } = await supabaseAdmin
    .from('trial_runs')
    .delete()
    .eq('trial_id', trialId);

  if (runsError) {
    throw new Error(`Failed to delete trial runs: ${runsError.message}`);
  }
}

module.exports = {
  countTrialRuns,
  createTrialRun,
  appendTrialEvent,
  completeTrialRun,
  failTrialRun,
  getTrialRuns,
  getTrialEvents,
  deleteTrialData,
};
