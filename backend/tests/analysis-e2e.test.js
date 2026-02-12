const axios = require('axios');

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
});
