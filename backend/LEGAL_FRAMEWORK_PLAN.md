# Croatian Legal Framework Vector Database Implementation Plan

## 🎯 Project Overview

Transform the legal assistant into a comprehensive RAG (Retrieval-Augmented Generation) system by building a vector database from Croatian legal sources, starting with narodne-novine.nn.hr focusing on laws ("zakon") with "procisceni tekst" (cleaned/codified text).

## 📋 Scope & Requirements

### **Data Sources**
- **Primary**: narodne-novine.nn.hr API (official gazette)
- **Secondary**: zakon.hr (official law portal) - fallback source
- **Document Type**: "zakon" (laws) only initially
- **Text Format**: "procisceni tekst" (cleaned/codified text)
- **Time Coverage**: Last 15 years (2010-2025) then backward to 1990

### **Technical Stack**
- **Embedding Model**: `sentence-transformers/paraphrase-multilingual-mpnet-base-v2` (Hugging Face)
- **Vector Database**: PostgreSQL with pgvector extension
- **Embedding Dimension**: 768 (model-specific)
- **Chunking Strategy**: Article-level ("Članak 1", "Članak 2") with semantic fallback

## 🗓️ Phase 1: Local Development Setup (Week 1)

### **1.1 Branch Creation**
```bash
# Create dedicated branch for legal framework development
git checkout -b legal-framework-db
git push -u origin legal-framework-db

# Navigate to project directory
cd /home/oxioxi/proj/our_chattie/backend
```

### **1.2 Environment Setup**
```bash
# Install required dependencies
npm install @xenova/transformers pgvector @supabase/pgvector-js
npm install --save-dev dotenv

# Set up local PostgreSQL with pgvector
docker-compose up -d postgres+pgvector

# Create environment file
cp .env .env.local
# Add to .env.local:
# DATABASE_URL=postgresql://localhost:5432/legal_framework
# EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-mpnet-base-v2
```

### **1.3 Database Schema Setup**
```sql
-- Create database and extensions
CREATE DATABASE legal_framework;

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Main legal framework table
CREATE TABLE legal_articles (
    id BIGSERIAL PRIMARY KEY,
    law_id VARCHAR(255) NOT NULL,
    law_name VARCHAR(255) NOT NULL,
    law_type VARCHAR(50) NOT NULL, -- 'zakon', 'uredba', 'pravilnik'
    publication_date DATE,
    official_gazette_number VARCHAR(50),
    year INTEGER,
    edition VARCHAR(50),
    act_number VARCHAR(50),
    article_number VARCHAR(20), -- "Članak 1", "Članak 2"
    article_title TEXT,
    article_content TEXT,
    embedding vector(768), -- For sentence-transformers model
    metadata JSONB,
    is_consolidated BOOLEAN DEFAULT FALSE,
    consolidation_date DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (publication_date);

-- Indexes for performance
CREATE INDEX ON legal_articles 
USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON legal_articles (law_name, year, law_type);

-- Consolidation tracking table
CREATE TABLE consolidation_log (
    id SERIAL PRIMARY KEY,
    law_id BIGINT REFERENCES legal_articles(id),
    previous_version TEXT,
    new_version TEXT,
    consolidation_date DATE,
    affected_articles INTEGER[],
    created_at TIMESTAMP DEFAULT NOW()
);
```

## 🤖️ Phase 2: Core Scraper Development (Weeks 2-3)

### **2.1 Narodne Novine API Service**

Create `backend/services/narodneNovineService.js`:

```javascript
const axios = require('axios');

class NarodneNovineService {
    constructor() {
        this.baseUrl = 'https://narodne-novine.nn.hr/api';
        this.requestQueue = [];
        this.lastRequestTime = 0;
        this.requestDelay = 350; // Respect 3 req/sec limit
        this.maxRetries = 3;
    }

    async getAvailableYears() {
        try {
            const response = await this.rateLimitedRequest('/index', {});
            return response.years || [];
        } catch (error) {
            console.error('Error getting years:', error.message);
            return [];
        }
    }

    async getEditions(part, year) {
        const payload = { part, year };
        return await this.rateLimitedRequest('/editions', payload);
    }

    async getActs(part, year, edition) {
        const payload = { part, year, edition };
        return await this.rateLimitedRequest('/acts', payload);
    }

    async getActMetadata(part, year, edition, actNum) {
        const payload = {
            part,
            year,
            number: edition,
            act_num: actNum,
            format: "JSON-LD"
        };
        
        try {
            const response = await this.rateLimitedRequest('/act', payload);
            return response;
        } catch (error) {
            console.error(`Error getting act ${actNum}:`, error.message);
            return null;
        }
    }

    async getProcisceniTekst(act) {
        const payload = {
            part: act.part,
            year: act.year,
            number: act.edition,
            act_num: act.act_num
        };

        try {
            const response = await this.rateLimitedRequest('/act', {
                ...payload,
                view: 'procisceni_tekst'
            });
            return response.procisceni_tekst || act.clean_text;
        } catch (error) {
            console.error('Error getting cleaned text:', error.message);
            return act.clean_text; // Fallback to regular cleaned text
        }
    }

    async rateLimitedRequest(endpoint, payload) {
        // Implement exponential backoff with jitter
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.requestDelay) {
            await this.sleep(this.requestDelay - timeSinceLastRequest);
        }

        let delay = this.requestDelay;
        let attempt = 1;
        
        while (attempt <= this.maxRetries) {
            try {
                const response = await axios.post(`${this.baseUrl}${endpoint}`, payload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Legal-Assistant/1.0'
                    },
                    timeout: 30000
                });
                
                this.lastRequestTime = Date.now();
                return response.data;
            } catch (error) {
                if (attempt === this.maxRetries) {
                    throw error;
                }
                
                console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
                delay = delay * Math.pow(2, attempt - 1) + Math.random() * 100;
                await this.sleep(delay);
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = NarodneNovineService;
```

### **2.2 Legal Framework Scraper**

Create `backend/scripts/legalFrameworkScraper.js`:

```javascript
const NarodneNovineService = require('../services/narodneNovineService');

class LegalFrameworkScraper {
    constructor() {
        this.nnService = new NarodneNovineService();
        this.vectorService = require('../services/vectorizationService');
        this.db = require('../db');
    }

    async scrapeEssentialLaws() {
        console.log('🚀 Starting essential laws scraping...');
        
        // Get available years, start with most recent 5
        const years = await this.nnService.getAvailableYears();
        const prioritizedYears = years.slice(-5).reverse(); // 2021-2025
        
        let processedCount = 0;
        
        for (const year of prioritizedYears) {
            console.log(`📅 Processing year ${year}...`);
            
            const editions = await this.nnService.getEditions("SL", year);
            if (!editions.length) {
                console.log(`⚠️ No editions found for ${year}`);
                continue;
            }
            
            for (const edition of editions) {
                console.log(`📚 Processing edition ${edition}...`);
                
                const acts = await this.nnService.getActs("SL", year, edition);
                for (const actNum of acts) {
                    const act = await this.nnService.getActMetadata("SL", year, edition, actNum);
                    
                    if (!act || !act.naziv) {
                        console.log(`⚠️ Skipping invalid act ${actNum}`);
                        continue;
                    }
                    
                    // Focus on laws only initially
                    if (act.tip_dokumenta === 'zakon') {
                        const cleanedText = await this.nnService.getProcisceniTekst(act);
                        
                        if (cleanedText) {
                            await this.processAndStore(act, cleanedText);
                            processedCount++;
                            
                            // Progress reporting
                            if (processedCount % 10 === 0) {
                                console.log(`✅ Processed ${processedCount} laws so far...`);
                            }
                        }
                    }
                    
                    // Rate limiting delay
                    await this.sleep(400);
                }
            }
        }
        
        console.log(`🎉 Completed essential laws scraping. Processed ${processedCount} laws.`);
        return processedCount;
    }

    async processAndStore(act, cleanedText) {
        try {
            // Extract articles using legal structure
            const articles = this.extractArticles(cleanedText);
            
            for (const article of articles) {
                // Generate embedding using sentence-transformers
                const embedding = await this.vectorService.generateEmbedding(article.content);
                
                // Store in database
                await this.storeArticle(act, article, embedding);
            }
            
            console.log(`✅ Stored law: ${act.naziv} with ${articles.length} articles`);
        } catch (error) {
            console.error(`❌ Error processing law ${act.naziv}:`, error.message);
        }
    }

    extractArticles(text) {
        // Extract Članak (article) sections
        const articleRegex = /Članak\s+(\d+)\s*[.:]?\s*(.*?)(?=Članak|\n|$)/g;
        const articles = [];
        let match;
        
        while ((match = articleRegex.exec(text)) !== null) {
            articles.push({
                article_number: match[1],
                title: this.extractArticleTitle(match[2]),
                content: match[2] ? match[2].trim() : '',
                start_pos: match.index,
                end_pos: match.index + match[0].length
            });
        }
        
        return articles.length > 0 ? articles : [{
            article_number: '1',
            title: act.naziv || 'Untitled',
            content: text,
            start_pos: 0,
            end_pos: text.length
        }];
    }

    extractArticleTitle(content) {
        // Extract first line or meaningful title
        const lines = content.split('\n').filter(line => line.trim().length > 0);
        return lines[0] || this.truncateText(content, 100);
    }

    truncateText(text, maxLength) {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    async storeArticle(act, article, embedding) {
        const query = `
            INSERT INTO legal_articles (
                law_id, law_name, law_type, publication_date, 
                official_gazette_number, year, edition, act_number,
                article_number, article_title, article_content, 
                embedding, metadata, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (law_id) DO NOTHING
        `;
        
        const values = [
            `${act.godina}-${act.broj}-${act.izdanak}`, // Unique ID
            act.naziv,
            act.tip_dokumenta,
            act.datum_objave,
            act.nn_broj,
            act.godina,
            act.edicija,
            act.broj,
            article.article_number,
            article.title,
            article.content,
            JSON.stringify(embedding),
            JSON.stringify({
                gazette_reference: `NN ${act.nn_broj}/${act.godina}`,
                source: 'narodne-novine',
                law_type: act.tip_dokumenta
            })
        ];
        
        await this.db.query(query, values);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Run if called directly
if (require.main === module) {
    const scraper = new LegalFrameworkScraper();
    scraper.scrapeEssentialLaws()
        .then(count => console.log(`Scraping completed. ${count} laws processed.`))
        .catch(error => console.error('Scraping failed:', error));
}

module.exports = LegalFrameworkScraper;
```

## 🧠 Phase 3: Vectorization Service (Week 4)

### **3.1 Embedding Service**

Create `backend/services/vectorizationService.js`:

```javascript
const { pipeline } = require('@xenova/transformers');

class VectorizationService {
    constructor() {
        this.modelName = process.env.EMBEDDING_MODEL || 'sentence-transformers/paraphrase-multilingual-mpnet-base-v2';
        this.pipeline = null;
        this.initModel();
    }

    async initModel() {
        try {
            console.log(`🤖 Loading model: ${this.modelName}`);
            this.pipeline = await pipeline('feature-extraction', this.modelName);
            console.log('✅ Model loaded successfully');
        } catch (error) {
            console.error('❌ Failed to load model:', error.message);
            throw error;
        }
    }

    async generateEmbedding(text) {
        try {
            if (!this.pipeline) {
                await this.initModel();
            }

            // Generate embedding with truncation for long texts
            const result = await this.pipeline(text, {
                truncation: true,
                max_length: 512
            });

            // Extract embedding vector
            const embedding = result[0]?.values;
            
            if (!embedding) {
                throw new Error('No embedding generated');
            }

            return embedding;
        } catch (error) {
            console.error('❌ Embedding generation failed:', error.message);
            throw error;
        }
    }

    async batchGenerateEmbeddings(texts) {
        const embeddings = [];
        const batchSize = 8; // Process in batches to manage memory
        
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            console.log(`🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(texts.length/batchSize)}`);
            
            const batchEmbeddings = await Promise.all(
                batch.map(text => this.generateEmbedding(text))
            );
            
            embeddings.push(...batchEmbeddings);
            
            // Small delay between batches
            if (i + batchSize < texts.length) {
                await this.sleep(100);
            }
        }
        
        return embeddings;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = VectorizationService;
```

## 🔍 Phase 4: RAG Integration (Weeks 5-6)

### **4.1 Legal RAG Service**

Create `backend/services/legalRAGService.js`:

```javascript
class LegalRAGService {
    constructor(db, vectorService) {
        this.db = db;
        this.vectorService = vectorService;
    }

    async getLegalContext(query, maxResults = 5, similarityThreshold = 0.7) {
        try {
            // Generate embedding for the query
            const queryEmbedding = await this.vectorService.generateEmbedding(query);
            
            // Perform vector similarity search
            const vectorQuery = `
                SELECT 
                    law_id, law_name, article_number, article_title, article_content,
                    1 - (embedding <=> $1) as similarity
                FROM legal_articles 
                WHERE 1 - (embedding <=> $1) > $2
                ORDER BY similarity DESC
                LIMIT $3
            `;
            
            const results = await this.db.query(vectorQuery, [queryEmbedding, similarityThreshold, maxResults]);
            
            return this.formatLegalContext(results.rows);
        } catch (error) {
            console.error('❌ Legal context search failed:', error.message);
            return { legalProvisions: [], sources: [] };
        }
    }

    formatLegalContext(results) {
        const groupedByLaw = {};
        
        for (const result of results) {
            if (!groupedByLaw[result.law_name]) {
                groupedByLaw[result.law_name] = {
                    law: result.law_name,
                    articles: [],
                    gazette_reference: result.metadata?.gazette_reference
                };
            }
            
            groupedByLaw[result.law_name].articles.push({
                article: `Članak ${result.article_number}`,
                title: result.article_title,
                content: result.article_content.substring(0, 500) + '...',
                full_content: result.article_content
            });
        }
        
        return {
            legalProvisions: Object.values(groupedByLaw),
            sources: results.map(r => r.metadata?.gazette_reference)
        };
    }

    async searchByFilters(filters) {
        let whereClause = '1=1';
        const params = [];
        
        if (filters.law_name) {
            whereClause += ' AND law_name = $' + (params.length + 1);
            params.push(filters.law_name);
        }
        
        if (filters.year) {
            whereClause += ' AND year = $' + (params.length + 1);
            params.push(filters.year);
        }
        
        if (filters.law_type) {
            whereClause += ' AND law_type = $' + (params.length + 1);
            params.push(filters.law_type);
        }
        
        const query = `
            SELECT law_id, law_name, article_title, publication_date, metadata
            FROM legal_articles 
            WHERE ${whereClause}
            ORDER BY publication_date DESC
            LIMIT 50
        `;
        
        const results = await this.db.query(query, params);
        return results.rows;
    }
}

module.exports = LegalRAGService;
```

### **4.2 Enhanced Chat Integration**

Update `backend/chatAgent.js`:

```javascript
// Add legal context to existing chat analysis
const LegalRAGService = require('./services/legalRAGService');

class ChatAgent {
    constructor() {
        // ... existing constructor
        this.legalRAG = new LegalRAGService(this.db);
    }

    async processMessage(messages, progressCallback) {
        const userMessage = messages[messages.length - 1];
        
        // Check if user is asking about legal framework
        const isLegalQuery = this.detectLegalQuery(userMessage.content);
        
        if (isLegalQuery) {
            progressCallback?.({
                step: 'legal_context',
                progress: 20,
                message: 'Pretražujem zakonski okvir za kontekst...'
            });
            
            // Get relevant legal provisions
            const legalContext = await this.legalRAG.getLegalContext(userMessage.content);
            
            // Enhanced prompt with legal context
            const enhancedPrompt = this.buildLegalPrompt(userMessage.content, legalContext);
            
            // Continue with existing analysis pipeline
            return await this.runAnalysis(enhancedPrompt, progressCallback);
        }
        
        // Continue with existing logic for other queries
        return await this.runAnalysis(userMessage.content, progressCallback);
    }

    detectLegalQuery(message) {
        const legalKeywords = [
            'zakon', 'članak', 'odredba', 'propis', 'ustav',
            'pravo', 'sud', 'presuda', 'odluka', 'zakonski',
            'obveza', 'propisnic', 'procedura', 'propisanstvo'
        ];
        
        const lowerMessage = message.toLowerCase();
        return legalKeywords.some(keyword => lowerMessage.includes(keyword));
    }

    buildLegalPrompt(userQuery, legalContext) {
        let contextText = '';
        
        if (legalContext.legalProvisions.length > 0) {
            contextText = '\n\nKONTEKST ZAKONA:\n';
            legalContext.legalProvisions.forEach(provision => {
                contextText += `- ${provision.law}: ${provision.article}\n`;
                contextText += `  ${provision.content}\n`;
            });
            contextText += '\nIZVORI:\n';
            legalContext.sources.forEach(source => {
                contextText += `- ${source}\n`;
            });
        }
        
        return `${contextText}\n\nKORISNIČKO PITANJE:\n${userQuery}`;
    }
}
```

### **4.3 Enhanced Analysis Route**

Update `backend/server.js`:

```javascript
// Add new route for legal context search
app.post('/api/legal-search', async (req, res) => {
    try {
        const { query, filters = {}, maxResults = 5 } = req.body;
        
        const legalContext = await legalRAGService.getLegalContext(query, maxResults);
        
        res.json({
            success: true,
            data: legalContext,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Legal search error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
```

## 🚀 Phase 5: Testing & Deployment (Weeks 7-8)

### **5.1 Development Testing**

```bash
# Run scraper locally
npm run scrape:framework

# Test vector search
node -e "
const vectorService = require('./services/vectorizationService');
const embedding = await vectorService.generateEmbedding('Koja je nadležnost ugovora u Zakonu o obveznim odnosima?');
console.log('Embedding generated:', embedding);
"

# Test database queries
psql legal_framework -c "
SELECT law_name, COUNT(*) as article_count 
FROM legal_articles 
WHERE law_type = 'zakon' 
GROUP BY law_name;
"
```

### **5.2 Production Deployment**

```bash
# Environment variables for production
echo "EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-mpnet-base-v2" >> .env
echo "NODE_ENV=production" >> .env

# Database migration
psql legal_framework < migrations/01_initial_schema.sql

# Run scraper in production
node scripts/legalFrameworkScraper.js

# Set up cron job for daily updates
# Add to crontab: 0 2 * * * cd /path/to/project && node scripts/dailyUpdate.js
```

## 📊 Success Metrics

### **Technical Metrics**
- **Ingestion Success Rate**: >95% laws processed without errors
- **Embedding Quality**: Semantic similarity accuracy for legal queries
- **Search Performance**: <500ms response time for legal context
- **Database Performance**: Vector queries with appropriate indexing
- **API Compliance**: Consistent 3 req/sec rate limiting

### **Quality Metrics**
- **Legal Accuracy**: Correct article numbering and citation extraction
- **Text Completeness**: All "procisceni tekst" properly captured
- **Validation Confidence**: Cross-source verification >90% accuracy
- **User Satisfaction**: Legal queries return relevant, actionable provisions

## 🔄 Phase 6: Future Expansion (Months 3-6)

### **6.1 Historical Data Processing**
- Work backwards from 2020 to 1990
- Implement consolidations tracking
- Add legal precedence relationships
- Historical trend analysis

### **6.2 Enhanced Legal Intelligence**
- Cross-reference between different law types
- Identify legal contradictions or gaps
- Temporal evolution tracking
- EU harmonization analysis

### **6.3 Performance Optimization**
- Implement Redis caching for frequent queries
- Add vector quantization for storage efficiency
- Optimize database partitioning and indexing
- Implement intelligent query routing

## 🛡️ Risk Mitigation

### **API Rate Limiting**
- Respect 3 requests/second for narodne-novine
- Implement exponential backoff with jitter
- Monitor for API availability and fallback strategies
- Use official APIs when available

### **Data Validation**
- Cross-check against zakon.hr when possible
- Validate legal citations and references
- Implement confidence scoring for quality assurance
- Manual review workflow for consolidations

### **Legal Accuracy**
- Use Croatian-specific legal models when available
- Implement legal hierarchy validation
- Consult legal experts for critical consolidations
- Maintain audit trail for legal provisions

## 📝️ File Structure

```
backend/
├── scripts/
│   ├── legalFrameworkScraper.js    # Main scraper
│   ├── dailyUpdate.js              # Daily cron job
│   ├── monthlyConsolidation.js    # Monthly batch process
│   └── legalValidator.js           # Validation service
├── services/
│   ├── narodneNovineService.js  # API integration
│   ├── vectorizationService.js   # Text embedding
│   ├── legalRAGService.js      # RAG integration
│   └── legalValidator.js        # Validation logic
├── database/
│   ├── migrations/                 # Schema updates
│   └── seeds/                     # Initial data
├── tests/
│   ├── vectorization.test.js         # Unit tests
│   ├── rag.test.js                 # RAG functionality tests
│   └── integration.test.js         # End-to-end tests
└── package.json                    # Add new dependencies
```

## 🎯 Getting Started

1. **Clone and setup**: `git checkout legal-framework-db`
2. **Install dependencies**: `npm install @xenova/transformers pgvector`
3. **Database setup**: `docker-compose up -d postgres+pgvector`
4. **Run schema**: `psql legal_framework < migrations/01_initial_schema.sql`
5. **Test scraper**: `node scripts/legalFrameworkScraper.js`
6. **Integrate RAG**: Update chat and analysis routes
7. **Deploy**: Set up cron jobs and monitoring

This plan provides a complete roadmap for building a comprehensive Croatian legal framework vector database with sustainable daily operations and robust error handling.