const axios = require('axios');
const crypto = require('crypto');

const baseUrl = process.env.E2E_BASE_URL;
const token = process.env.E2E_SUPABASE_ACCESS_TOKEN;

const describeIfE2E = baseUrl ? describe : describe.skip;
const describeIfAuthed = baseUrl && token ? describe : describe.skip;

function authHeaders() {
  return {
    Authorization: `Bearer ${token}`,
  };
}

describeIfE2E('analysis auth (unauthenticated)', () => {
  test('requires auth for analysis runs list', async () => {
    await expect(
      axios.get(`${baseUrl}/api/analysis/runs`),
    ).rejects.toMatchObject({
      response: {
        status: 401,
      },
    });
  });

  test('requires auth for analysis run full detail', async () => {
    await expect(
      axios.get(`${baseUrl}/api/analysis/runs/${crypto.randomUUID()}/full`),
    ).rejects.toMatchObject({
      response: {
        status: 401,
      },
    });
  });
});

describeIfAuthed('analysis e2e (supabase)', () => {
  test('lists analysis runs for the authenticated user', async () => {
    const response = await axios.get(`${baseUrl}/api/analysis/runs`, {
      headers: authHeaders(),
    });

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('runs');
    expect(Array.isArray(response.data.runs)).toBe(true);
  });

  test('returns 404 for unknown analysis run full detail', async () => {
    await expect(
      axios.get(`${baseUrl}/api/analysis/runs/${crypto.randomUUID()}/full`, {
        headers: authHeaders(),
      }),
    ).rejects.toMatchObject({
      response: {
        status: 404,
      },
    });
  });

  test('returns run + events shape for existing run full detail', async () => {
    const listResponse = await axios.get(`${baseUrl}/api/analysis/runs?limit=1&offset=0`, {
      headers: authHeaders(),
    });

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.data?.runs)).toBe(true);

    const runId = listResponse.data?.runs?.[0]?.id;
    if (!runId) {
      return;
    }

    const detailResponse = await axios.get(`${baseUrl}/api/analysis/runs/${runId}/full`, {
      headers: authHeaders(),
    });

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.data).toHaveProperty('run');
    expect(detailResponse.data).toHaveProperty('events');
    expect(detailResponse.data).toHaveProperty('server_time');
    expect(detailResponse.data.run?.id).toBe(runId);
    expect(Array.isArray(detailResponse.data.events)).toBe(true);
  });
});
