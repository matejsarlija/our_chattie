# AGENTS.md - Development Guide for Agentic Coding

This repository is a full-stack monorepo for an AI-powered legal assistant that analyzes Croatian court records. This guide helps agentic coding agents become productive quickly.

## Project Structure

```
our_chattie/
├── backend/          # Node.js/Express API server (CommonJS)
└── simple-chat/      # React frontend application (ES6)
```

## Build/Lint/Test Commands

### Backend (run from `backend/` directory)
- **Development**: `npm run dev` (uses nodemon server.js)
- **Production**: `npm run prod` or `npm start`
- **Testing**: `npm test` (Jest)
- **Single Test**: `npm test -- --testNamePattern="specific test name"` or `npm test path/to/test.js`
- **Test with coverage**: `npm test -- --coverage`

### Frontend (run from `simple-chat/` directory)
- **Development**: `npm start` (Create React App, port 3000)
- **Build**: `npm run build`
- **Testing**: `npm test` (Create React App Jest)
- **Single Test**: `npm test -- --testNamePattern="specific test name"`
- **Eject**: `npm run eject` (irreversible)

## Module Systems & Import Patterns

### Backend (CommonJS)
```javascript
// Use require() for imports
const express = require('express');
const { Pool } = require('pg');

// Dynamic imports for ESM modules
const { default: PQueue } = await import('p-queue');
```

### Frontend (ES6)
```javascript
// Use import statements
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
```

## Code Style Guidelines

### Naming Conventions
- **Components**: PascalCase (`AltChat.js`, `CourtAnalysisModal.js`)
- **Files**: kebab-case for directories (`court-analysis/`), camelCase for utilities
- **Functions/Variables**: camelCase (`handleChat`, `messageHistory`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_FILE_SIZE`)
- **Database tables**: snake_case (`subscriptions`)

### File Organization
```
backend/
├── server.js              # Main server entry point
├── chatAgent.js           # AI chat integration
├── db.js                  # Database connection
├── court-analysis/        # Analysis pipeline
│   ├── pipeline.js
│   ├── agents/
│   └── utils/
├── scraper/               # Web scraping logic
├── cron/                  # Scheduled tasks
├── services/              # External service integrations
└── helpers/               # Utility functions
```

### Error Handling Patterns
```javascript
// Backend pattern
try {
    const result = await operation();
    return result;
} catch (error) {
    console.error('Operation failed:', error);
    progressCallback?.({ step: 'error', message: error.message });
    throw error;
} finally {
    await cleanup();
}

// Frontend pattern
try {
    const response = await fetch(url);
    // handle response
} catch (err) {
    if (err.name !== 'AbortError') {
        setError(`Connection failed: ${err.message}. Please try again.`);
    }
}
```

## API Integration Patterns

### Streaming Responses (SSE)
```javascript
// Server-side (backend/server.js)
res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
});

for await (const chunk of result) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

// Client-side (frontend)
const response = await fetch(API_URL, { method: 'POST', body: formData });
const reader = response.body.getReader();
const decoder = new TextDecoder();
```

### File Upload Handling
```javascript
// Backend - multer configuration (2MB limit)
app.post('/api/chat', upload.single('file'), async (req, res) => {
    const messages = JSON.parse(req.body.messages);
    const file = req.file;
    // process...
});

// Frontend - FormData
const formData = new FormData();
formData.append('messages', JSON.stringify(chatMessages));
if (selectedFile) formData.append('file', selectedFile);
```

### Database Patterns
```javascript
// Use parameterized queries
const result = await db.query(
    'SELECT * FROM subscriptions WHERE email = $1',
    [email]
);

// Connection pooling in backend/db.js
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
```

## Testing Guidelines

### Backend Testing (Jest)
```javascript
// Set increased timeout for browser/Puppeteer tests
jest.setTimeout(60000);

// Test file location: backend/tests/
describe('Court Analysis Pipeline', () => {
    it('should process court documents', async () => {
        const result = await runCourtAnalysis(testData);
        expect(result).toBeDefined();
    });
});
```

### Frontend Testing
```javascript
// Use Create React App testing utilities
import { render, screen, fireEvent } from '@testing-library/react';

test('renders chat interface', () => {
    render(<AltChat />);
    expect(screen.getByText('Send')).toBeInTheDocument();
});
```

## Security Guidelines

### Rate Limiting
- Use token bucket algorithm (implemented in `backend/utils/rate-limiter.js`)
- Apply to all public endpoints

### Input Validation
- File uploads: 2MB limit, specific MIME types
- Sanitize all user inputs
- Use parameterized database queries

### CORS Configuration
```javascript
// Production domains only
app.use(cors({
    origin: ['https://yourdomain.com', 'https://www.yourdomain.com'],
    credentials: true
}));
```

## Performance Guidelines

### Resource Management
- Always cleanup temporary files after processing
- Use connection pooling for database
- Reuse Puppeteer instances when possible
- Implement proper error recovery with fallbacks

### Queue Management
- Use `p-queue` for long-running tasks to prevent overload
- Import dynamically to avoid startup issues:
```javascript
const { default: PQueue } = await import('p-queue');
```

## Environment Configuration

### Required Environment Variables
- `GOOGLE_API_KEY` - Google Generative AI API key
- `DATABASE_URL` - PostgreSQL connection string
- `NODE_ENV` - Environment (development/production)
- `PORT` - Server port (optional, defaults to 3001)

### Development Setup
1. Backend: `cd backend && npm install && npm run dev`
2. Frontend: `cd simple-chat && npm install && npm start`
3. Database: Set up PostgreSQL with connection string

## Key Integration Points

### External Services
- **Google Generative AI**: `gemini-2.0-flash` model via LangChain
- **SendGrid**: Email notifications
- **Puppeteer**: Web scraping for court records
- **PostgreSQL**: Primary database

### Critical Files to Understand
- `backend/server.js` - Main server and API routes
- `backend/chatAgent.js` - AI integration
- `backend/court-analysis/pipeline.js` - Analysis orchestration
- `simple-chat/src/components/AltChat.js` - Frontend chat interface
- `backend/db.js` - Database connection layer

## Common Pitfalls to Avoid

1. **Top-level async imports**: Use dynamic imports in functions for ESM modules
2. **Streaming SSE format**: Must use `data: {...}\n\n` format exactly
3. **File cleanup**: Always remove temporary files after processing
4. **Message format**: Keep frontend and backend message shapes in sync
5. **Browser resource blocking**: Use Puppeteer request interception for performance

## Development Workflow

1. Make changes to backend/frontend
2. Test locally with development servers
3. Run test suites: `npm test` in respective directories
4. For integration tests, ensure database is available
5. Test streaming endpoints with tools like curl or Postman

## Forward Development Reference

### Current Architecture Status: 7/10
- Good foundation with strategic improvements needed
- Production ready with security hardening and monitoring

### Immediate Priorities (1-2 weeks)
1. **Component Refactoring** - Split AltChat.js (762 lines → smaller components)
2. **Structured Logging** - Replace console.log with winston/pino
3. **Input Validation** - Comprehensive sanitization for legal documents
4. **Error Standardization** - Consistent API error responses

### Production Hardening (1-2 months)
1. **State Management** - Context API/Zustand for complex state
2. **Database Improvements** - Audit tables, proper indexing
3. **API Documentation** - OpenAPI/Swagger specification
4. **Caching Layer** - Redis for repeated search results

### Strategic Improvements (3-6 months)
1. **Queue System** - Redis/RabbitMQ for async processing
2. **Microservices** - Split analysis, chat, scraping services
3. **Observability** - Logging, metrics, tracing
4. **Authentication** - User management and access control

### Decision Points
- Ship current features vs. improve architecture first?
- User/document volume expectations for scaling decisions?
- Development time allocation: improvements vs. new features?

## Future Improvements

### Vite Migration (Recommended)
- **Current**: Create React App with 9 security vulnerabilities in build tools
- **Target**: Migrate to Vite for security fixes and 5-10x faster builds
- **Effort**: Medium (2-4 hours)
- **Breaking Changes**: Environment variables (`REACT_APP_` → `VITE_`), HTML template references
- **Files to Change**: package.json scripts, 3 environment variable references, index.html
- **Status**: Deferred - address after new features implemented

### Migration Commands (When Ready)
```bash
# When ready to migrate:
npm install -D vite @vitejs/plugin-react
# Update package.json scripts
# Change REACT_APP_* to VITE_* in AltChat.js and CourtAnalysisModal.js
# Create vite.config.js
# Update index.html (%PUBLIC_URL% → /)
```

### Migration Notes
- Critical to test API endpoints after environment variable changes
- Verify file upload functionality
- Update deployment process for Vite build output
- Benefits: Instant hot module replacement, security vulnerability fixes, modern development experience