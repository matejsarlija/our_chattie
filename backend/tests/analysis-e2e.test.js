const axios = require('axios');
const crypto = require('crypto');

const baseUrl = process.env.E2E_BASE_URL;

const describeIfE2E = baseUrl ? describe : describe.skip;

describeIfE2E('analysis runs API (local store)', () => {
  test('lists analysis runs without authentication', async () => {
    const response = await axios.get(`${baseUrl}/api/analysis/runs`);

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('runs');
    expect(Array.isArray(response.data.runs)).toBe(true);
    expect(response.data).toHaveProperty('count');
  });

  test('returns 404 for unknown analysis run full detail', async () => {
    await expect(
      axios.get(`${baseUrl}/api/analysis/runs/${crypto.randomUUID()}/full`),
    ).rejects.toMatchObject({
      response: {
        status: 404,
      },
    });
  });

  test('returns run + events shape for existing run full detail', async () => {
    const listResponse = await axios.get(`${baseUrl}/api/analysis/runs?limit=1&offset=0`);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.data?.runs)).toBe(true);

    const runId = listResponse.data?.runs?.[0]?.id;
    if (!runId) {
      return;
    }

    const detailResponse = await axios.get(`${baseUrl}/api/analysis/runs/${runId}/full`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.data).toHaveProperty('run');
    expect(detailResponse.data).toHaveProperty('events');
    expect(detailResponse.data).toHaveProperty('server_time');
    expect(detailResponse.data.run?.id).toBe(runId);
    expect(Array.isArray(detailResponse.data.events)).toBe(true);
  });
});
