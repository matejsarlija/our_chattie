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
            const response = await axios.post(
                this.authUrl,
                qs.stringify({
                    grant_type: 'client_credentials',
                    client_id: this.clientId,
                    client_secret: this.clientSecret
                }),
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
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
     * Search for a company. 
     */
    async searchCompany(name) {
        try {
            return await this.executeRequest('GET', '/subjekti', { 
                naziv: name 
            });
        } catch (error) {
            console.warn(`[CourtRegistry] Search failed for ${name}: ${error.message}`);
            return null;
        }
    }

    /**
     * Fetch full details by MBS
     */
    async getCompanyDetails(mbs) {
        try {
            return await this.executeRequest('GET', `/subjekti/${mbs}`);
        } catch (error) {
            console.error(`[CourtRegistry] Could not fetch details for MBS ${mbs}`);
            return null;
        }
    }
}

module.exports = new CourtRegistryClient();
