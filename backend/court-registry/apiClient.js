// backend/court-registry/apiClient.js
const axios = require('axios');
const qs = require('querystring');

class CourtRegistryClient {
    constructor() {
        this.baseUrl = process.env.COURT_REGISTRY_API_URL || 'https://sudreg-data.gov.hr/api/javni';
        this.authUrl = 'https://sudreg-data.gov.hr/api/oauth/token';
        this.clientId = process.env.COURT_REGISTRY_CLIENT_ID;
        this.clientSecret = process.env.COURT_REGISTRY_CLIENT_SECRET;

        this.token = null;
        this.tokenExpiresAt = 0;

        // Queue for rate limiting (Simple FIFO)
        this.requestQueue = Promise.resolve();
        // PDF Page 20: "detalji_subjekta... 6 zahtjeva po minuti"
        // We set a safe buffer of 11 seconds between calls to be safe.
        this.minRequestInterval = 11000;
        this.lastRequestTime = 0;
    }

    /**
     * Authenticates using Client Credentials Flow (PDF Page 19)
     */
    async authenticate() {
        if (this.token && Date.now() < this.tokenExpiresAt) {
            return this.token;
        }

        if (!this.clientId || !this.clientSecret) {
            console.warn('[CourtRegistry] Missing API credentials. API calls will fail.');
            return null;
        }

        try {
            // Use HTTP Basic Auth as per official API documentation
            const response = await axios.post(
                this.authUrl,
                qs.stringify({
                    grant_type: 'client_credentials'
                }),
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    auth: {
                        username: this.clientId,
                        password: this.clientSecret
                    }
                }
            );

            this.token = response.data.access_token;
            // PDF Page 19: "expires_in": 21600 (seconds)
            // Subtract 5 minutes for safety buffer
            this.tokenExpiresAt = Date.now() + (response.data.expires_in * 1000) - 300000;
            console.log('[CourtRegistry] Authentication successful.');
            return this.token;
        } catch (error) {
            console.error('[CourtRegistry] Auth failed:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with Court Registry API');
        }
    }

    /**
     * Executes a request with Rate Limiting and Auth
     */
    async executeRequest(method, endpoint, params = {}) {
        // Chaining promises to enforce sequential execution
        this.requestQueue = this.requestQueue.then(async () => {
            const now = Date.now();
            const timeSinceLast = now - this.lastRequestTime;

            if (timeSinceLast < this.minRequestInterval) {
                const waitTime = this.minRequestInterval - timeSinceLast;
                console.log(`[CourtRegistry] Rate limit active. Waiting ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            this.lastRequestTime = Date.now();
        });

        await this.requestQueue;
        const token = await this.authenticate();

        if (!token) {
            throw new Error('No authentication token available');
        }

        try {
            const response = await axios({
                method,
                url: `${this.baseUrl}${endpoint}`,
                params,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            // Re-throw for the enricher to handle.
            throw error;
        }
    }

    /**
     * Search for a company by OIB (primary method - exact match).
     * Uses /detalji_subjekta endpoint which supports direct OIB lookup
     * and returns full details (including for inactive/bankruptcy entities).
     * @param {string} oib - The company's OIB number
     * @returns {Promise<object|null>} - Single company object or null
     */
    async searchByOib(oib) {
        try {
            const result = await this.executeRequest('GET', '/detalji_subjekta', {
                tip_identifikatora: 'oib',
                identifikator: oib,
                no_data_error: '0',
                expand_relations: true // Fetch connected entities (directors, founders)
            });

            // The endpoint returns the object directly, or empty/null
            if (result && result.mbs) {
                return result;
            }
            return null;
        } catch (error) {
            console.warn(`[CourtRegistry] OIB search failed for ${oib}: ${error.message}`);
            return null;
        }
    }

    /**
     * Search for a company by name.
     * @param {string} name - Company name to search for
     * @param {object} options - Search options
     * @param {boolean} options.includeInactive - If true, includes inactive (e.g. bankruptcy) entities. Defaults to true.
     */
    async searchCompany(name, options = { includeInactive: true }) {
        try {
            const params = {
                naziv: name,
                // API default is only_active=true. We want to include inactive by default 
                // for bankruptcy notices, so we set only_active='false'
                only_active: options.includeInactive ? 'false' : 'true'
            };

            return await this.executeRequest('GET', '/subjekti', params);
        } catch (error) {
            console.warn(`[CourtRegistry] Search failed for ${name}: ${error.message}`);
            return null;
        }
    }

    async getCompanyDetails(mbs) {
        try {
            // NOTE: /subjekti/${mbs} returns 404. 
            // The correct way to get full details by MBS is via /detalji_subjekta.
            return await this.executeRequest('GET', '/detalji_subjekta', {
                tip_identifikatora: 'mbs',
                identifikator: mbs,
                expand_relations: true,
                no_data_error: '0'
            });
        } catch (error) {
            console.error(`[CourtRegistry] Could not fetch details for MBS ${mbs}: ${error.message}`);
            return null;
        }
    }
}

module.exports = new CourtRegistryClient();
