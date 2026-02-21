// Keep all your original CommonJS require() statements at the top
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { requireSupabaseAuth, optionalSupabaseAuth } = require('./middleware/supabaseAuth');
const { validateDocumentEditPayload } = require('./helpers/documentEditValidation');
const { buildSseData, buildSseEvent } = require('./helpers/sse');
const { createAnalysisRunStreamHandler } = require('./helpers/analysisStreamHandler');
const { parsePagination } = require('./helpers/pagination');
const { sanitizeMarkdown } = require('./helpers/sanitize');
const { DEFAULT_TRIAL_LIMIT, isTrialAllowed } = require('./helpers/trial');
const {
  isTerminalStatus,
  buildCursor,
  didRunChange,
  getNewEvents,
  shouldStartStreamTimers,
} = require('./helpers/analysisStream');
const { CourtSearchPuppeteer } = require('./scraper/courtSearchPuppeteer');
const rateLimiter = require('./court-analysis/utils/rateLimiter');
const { runCourtAnalysis } = require('./court-analysis/pipeline');
const { getSupabaseAdminClient } = require('./services/supabase');
const {
  createAnalysisRun,
  appendAnalysisEvent,
  completeAnalysisRun,
  failAnalysisRun,
  listAnalysisRuns,
  getAnalysisRun,
  getAnalysisEvents,
  getAnalysisRunFull,
} = require('./services/analysisStore');
const {
  countTrialRuns,
  createTrialRun,
  appendTrialEvent,
  completeTrialRun,
  failTrialRun,
  getTrialRuns,
  getTrialEvents,
  deleteTrialData,
} = require('./services/trialStore');

let chatAgent = null;

function getChatAgent() {
  if (!chatAgent) {
    chatAgent = require('./chatAgent');
  }
  return chatAgent;
}

// ========= CHANGE 1: REMOVE THE BROKEN REQUIRE STATEMENT =========
// const PQueue = require('p-queue').default; // This line is removed


// ========= CHANGE 2: WRAP THE ENTIRE SERVER LOGIC IN AN ASYNC FUNCTION =========
async function startServer() {

  // ========= CHANGE 3: DYNAMICALLY IMPORT P-QUEUE HERE =========
  // We use await to pause execution until the module is loaded.
  // We use { default: PQueue } because p-queue uses a default export.
  const { default: PQueue } = await import('p-queue');
  console.log('p-queue module loaded successfully.');

  // ========= CHANGE 4: THE REST OF YOUR CODE MOVES INSIDE THIS FUNCTION =========
  // Now that PQueue is defined, we can create the app and the queue.
  const db = require('./db'); // Import our database module

  const app = express();
  app.set('trust proxy', 1); // Trust the first proxy (e.g., React dev server or production LB)
  const port = Number(process.env.PORT) || 3001;
  const host = '0.0.0.0';
  const courtAnalysisQueue = new PQueue({ concurrency: 1 }); // This should work now
  const trialCookieSecret = process.env.TRIAL_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!trialCookieSecret) {
    console.warn('[Trial] TRIAL_COOKIE_SECRET is missing. Anonymous trial flow will be disabled.');
  }

  // Configure multer for file uploads (same as working version)
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      const uploadDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  });

  // File filter to allow only PDFs and images
  const fileFilter = (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/x-pdf', 'application/acrobat', 'application/vnd.pdf', 'image/jpeg', 'image/png'];
    const isPdfByExtension = path.extname(file.originalname || '').toLowerCase() === '.pdf';
    const isOctetStreamPdf = file.mimetype === 'application/octet-stream' && isPdfByExtension;

    if (allowedTypes.includes(file.mimetype) || isOctetStreamPdf) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Only PDFs and images are allowed.'), false);
    }
  };

  const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
      fileSize: 2 * 1024 * 1024 // Limit file size to 2MB
    }
  });

  // Middleware (same as working version)
  app.use(helmet());
  if (trialCookieSecret) {
    app.use(cookieParser(trialCookieSecret));
  }

  // Rate limiters
  app.use('/api/chat', rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: 15, // 15 requests per minute
    message: "Previše zahtjeva. Molimo pokušajte ponovno za 1 minutu."
  }));

  app.use('/api/chat', rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hour window
    max: 1500, // 1500 requests per day
    message: "Dosegnuli ste dnevno ograničenje. Molimo pokušajte ponovno sutra."
  }));

  // Document edit rate limiters (separate from chat)
  app.use('/api/document-edit', rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: 10, // 10 requests per minute
    message: "Previše zahtjeva za uređivanje. Molimo pokušajte ponovno za 1 minutu."
  }));

  app.use('/api/document-edit', rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hour window
    max: 500, // 500 requests per day
    message: "Dosegnuli ste dnevno ograničenje za uređivanje. Molimo pokušajte ponovno sutra."
  }));

  // Define default allowed origins based on environment
  let allowedOrigins = [
    'https://our-chattie-front.onrender.com',
    'https://alimentacija.info',
    'https://www.alimentacija.info'
  ];

  // Only allow localhost in development or if explicitly requested
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3000');
  }

  // If environment variable exists, merge it in to allow for additional flexibility
  if (process.env.CORS_ORIGIN) {
    const envOrigins = process.env.CORS_ORIGIN.split(',').map(item => item.trim());
    // Create a unique set of origins to avoid duplicates
    allowedOrigins = [...new Set([...allowedOrigins, ...envOrigins])];
  }

  const corsOrigin = allowedOrigins;

  app.use(cors({
    origin: corsOrigin,
    credentials: true
  }));

  app.use(express.json());

  const trialCookieName = 'trial_id';
  const trialCookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    signed: true,
  };

  const ensureTrialCookie = (req, res) => {
    if (!trialCookieSecret) return null;
    let trialId = req.signedCookies?.[trialCookieName];
    if (!trialId) {
      trialId = crypto.randomUUID();
      res.cookie(trialCookieName, trialId, trialCookieOptions);
    }
    return trialId;
  };

  const clearTrialCookie = (res) => {
    if (!trialCookieSecret) return;
    res.clearCookie(trialCookieName, {
      httpOnly: true,
      sameSite: trialCookieOptions.sameSite,
      secure: trialCookieOptions.secure,
      signed: true,
    });
  };

  // Document edit endpoint for specialized AI-assisted text modification
  app.post('/api/document-edit', async (req, res) => {
    let handleDocumentEdit;
    try {
      ({ handleDocumentEdit } = getChatAgent());
    } catch (agentError) {
      console.error('[AI] chatAgent init failed:', agentError);
      return res.status(503).json({ error: 'AI service unavailable.' });
    }

    try {
      const { content, instruction, context, selectionRange, mode } = req.body || {};
      const validation = validateDocumentEditPayload({ content, instruction, selectionRange });
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
      }

      console.log('Document edit request:', {
        instructionPreview: instruction.substring(0, 50),
        contentLength: content.length,
        hasContext: !!context
      });

      const result = await handleDocumentEdit({ content, instruction, context, selectionRange, mode });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      let clientClosed = false;
      let timedOut = false;
      const requestTimeoutMs = 60000;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: 'Request timed out.' })}\n\n`);
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        }
      }, requestTimeoutMs);

      req.on('close', () => {
        clientClosed = true;
      });

      const extractChunkText = (chunk) => {
        if (!chunk) return '';
        if (typeof chunk.text === 'function') {
          try {
            return chunk.text();
          } catch {
            return '';
          }
        }
        if (typeof chunk.content === 'string') return chunk.content;
        if (Array.isArray(chunk.content)) {
          return chunk.content
            .map((part) => (typeof part === 'string' ? part : (part?.text || '')))
            .join('');
        }
        if (typeof chunk.text === 'string') return chunk.text;
        return '';
      };

      try {
        let sentAny = false;
        let loggedFirstChunk = false;
        for await (const chunk of result.stream) {
          if (clientClosed || timedOut) {
            break;
          }
          const text = extractChunkText(chunk);
          if (text) {
            sentAny = true;
            res.write(buildSseData({ content: text }));
          } else if (!loggedFirstChunk && process.env.NODE_ENV !== 'production') {
            console.log('Document edit stream first chunk (no text):', {
              keys: chunk ? Object.keys(chunk) : null,
              contentType: typeof chunk?.content,
              contentIsArray: Array.isArray(chunk?.content)
            });
            loggedFirstChunk = true;
          }
        }
        if (!clientClosed && !timedOut) {
          if (!sentAny) {
            res.write(buildSseData({ error: 'No response from model.' }));
          }
          res.write(buildSseData({ done: true, mode: mode || 'preview' }));
        }
      } catch (streamError) {
        console.error('Document edit streaming error:', streamError);
        if (!res.writableEnded) {
          res.write(buildSseData({ error: 'Streaming failed' }));
        }
      }
      clearTimeout(timeoutId);

      res.end();

    } catch (error) {
      console.error('Document edit error:', error);
      res.status(500).json({ error: error.message || 'AI service unavailable' });
    }
  });

  // Chat endpoint with proper streaming format
  app.post('/api/chat', upload.single('file'), async (req, res) => {
    let uploadedFilePath = null;
    let handleChatMessage;
    try {
      ({ handleChatMessage } = getChatAgent());
    } catch (agentError) {
      console.error('[AI] chatAgent init failed:', agentError);
      return res.status(503).json({ error: 'AI service unavailable.' });
    }

    try {
      let { messages } = req.body;

      if (typeof messages === 'string') {
        messages = JSON.parse(messages);
      }

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        throw new Error("No messages provided");
      }

      uploadedFilePath = req.file?.path;

      console.log('Chat request:', {
        messageCount: messages?.length,
        hasFile: !!uploadedFilePath,
        messagesType: typeof messages,
        firstMessage: messages?.[0]
      });

      const result = await handleChatMessage({
        messages: messages,
        filePath: uploadedFilePath,
        originalFilename: req.file?.originalname
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const extractChunkText = (chunk) => {
        if (!chunk) return '';
        if (typeof chunk.text === 'function') {
          try {
            return chunk.text();
          } catch {
            return '';
          }
        }
        if (typeof chunk.content === 'string') return chunk.content;
        if (Array.isArray(chunk.content)) {
          return chunk.content
            .map((part) => (typeof part === 'string' ? part : (part?.text || '')))
            .join('');
        }
        if (typeof chunk.text === 'string') return chunk.text;
        return '';
      };

      try {
        let sentAny = false;
        let loggedFirstChunk = false;
        for await (const chunk of result.stream) {
          // Robustly extract text content from LangChain message chunks
          const content = extractChunkText(chunk);

          if (content) {
            sentAny = true;
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          } else if (!loggedFirstChunk && process.env.NODE_ENV !== 'production') {
            console.log('Chat stream first chunk (no text):', {
              keys: chunk ? Object.keys(chunk) : null,
              contentType: typeof chunk?.content,
              contentIsArray: Array.isArray(chunk?.content)
            });
            loggedFirstChunk = true;
          }
        }
        if (!sentAny) {
          res.write(`data: ${JSON.stringify({ error: 'No response from model.' })}\n\n`);
        }
      } catch (streamError) {
        console.error('Streaming error:', streamError);
        res.write(`data: ${JSON.stringify({ error: 'Streaming failed' })}\n\n`);
      }

      if (uploadedFilePath) {
        fs.unlink(uploadedFilePath, (err) => {
          if (err) console.error('Error deleting file:', err);
        });
        uploadedFilePath = null;
      }

      res.end();

    } catch (error) {
      console.error('Chat error:', error);

      if (uploadedFilePath) {
        fs.unlink(uploadedFilePath, (err) => {
          if (err) console.error('Error deleting file:', err);
        });
      }

      res.write(`data: ${JSON.stringify({ error: error.message || 'AI service unavailable' })}\n\n`);
      res.end();
    }
  });

  app.post('/api/court-search', async (req, res) => {
    try {
      const { searchTerm, searchType = 'oib' } = req.body;

      const automator = new CourtSearchPuppeteer();
      await automator.init();

      const results = await automator.performSearch(searchTerm);

      // This function needs to be defined or imported
      // const latestCases = getLatestCases(results.results); 

      // This function needs to be defined or imported
      // const analyzedCases = await analyzeCourtCases(latestCases); 

      await automator.close();

      res.json({
        success: true,
        // cases: analyzedCases, // Using placeholder
        totalFound: results.results.length,
        // processedCases: analyzedCases.length // Using placeholder
      });

    } catch (error) {
      console.error('Court search error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.use('/api/court-analysis', rateLimiter);

  const analysisWriteIpLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Previše zahtjeva. Molimo pokušajte ponovno za 1 minutu.',
  });

  const analysisWriteUserLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 6,
    keyGenerator: (req) => req.user?.id || req.ip,
    message: 'Previše zahtjeva za analizu. Molimo pokušajte ponovno za 1 minutu.',
  });

  const analysisReadIpLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: 'Previše zahtjeva. Molimo pokušajte ponovno za 1 minutu.',
  });

  const analysisReadUserLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    keyGenerator: (req) => req.user?.id || req.ip,
    message: 'Previše zahtjeva za analizu. Molimo pokušajte ponovno za 1 minutu.',
  });

  app.post('/api/court-analysis', analysisWriteIpLimiter, optionalSupabaseAuth, analysisWriteUserLimiter, async (req, res) => {
    const { searchTerm } = req.body;

    if (!searchTerm) {
      return res.status(400).json({ error: 'Search term is required' });
    }

    if (req.authError) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    const isAuthed = Boolean(req.user);
    let supabaseAdmin = req.supabaseAdmin || null;
    let trialId = null;

    if (!isAuthed) {
      try {
        supabaseAdmin = supabaseAdmin || getSupabaseAdminClient();
      } catch (err) {
        console.error('[Trial] Supabase admin unavailable:', err.message);
        return res.status(503).json({ error: 'Trial flow unavailable.' });
      }

      trialId = ensureTrialCookie(req, res);
      if (!trialId) {
        return res.status(500).json({ error: 'Trial flow unavailable.' });
      }
      try {
        const runsUsed = await countTrialRuns({ supabaseAdmin, trialId });
        if (!isTrialAllowed({ runsUsed, limit: DEFAULT_TRIAL_LIMIT })) {
          return res.status(403).json({ error: 'Please sign in to continue.', code: 'AUTH_REQUIRED' });
        }
      } catch (err) {
        console.error('[Trial] Failed to check trial quota:', err.message);
        return res.status(500).json({ error: 'Trial quota check failed.' });
      }
    }

    // --- Step 1: Immediately set up the streaming connection for the user ---
    // This tells the browser to keep the connection open and wait for events.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Send these headers now to establish the connection.

    // --- Step 2: Add the heavy task to the queue to protect the server ---
    // The code inside add() will only run when it's this request's turn.
    courtAnalysisQueue.add(async () => {
      let analysisRun = null;
      let trialRun = null;

      // Define the progress callback INSIDE the queued job.
      // This is crucial because it gives the job access to this specific user's `res` object.
      const progressCallback = (data) => {
        // Safety check: Don't try to write to a connection that the user has already closed.
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      try {
        if (isAuthed) {
          analysisRun = await createAnalysisRun({
            supabase: req.supabase,
            userId: req.user.id,
            oib: searchTerm,
            status: 'running',
          });
        } else {
          trialRun = await createTrialRun({
            supabaseAdmin,
            trialId,
            oib: searchTerm,
            status: 'running',
          });
        }

        const runId = analysisRun?.id || trialRun?.id;

        const safeProgress = async (event) => {
          progressCallback(event);
          try {
            if (isAuthed) {
              await appendAnalysisEvent({
                supabase: req.supabase,
                analysisId: analysisRun.id,
                eventType: event.step || 'progress',
                message: event.message || null,
                metadata: {
                  progress: event.progress || null,
                  hasData: Boolean(event.data),
                },
              });
            } else {
              await appendTrialEvent({
                supabaseAdmin,
                trialRunId: trialRun.id,
                eventType: event.step || 'progress',
                message: event.message || null,
                metadata: {
                  progress: event.progress || null,
                  hasData: Boolean(event.data),
                },
              });
            }
          } catch (err) {
            console.error('[Analysis Events] Failed to persist event:', err.message);
          }
        };

        // Emit run id immediately so the client can start polling events.
        await safeProgress({
          step: 'queued',
          progress: 1,
          message: 'Zahtjev je zaprimljen.',
          analysisId: runId,
        });

        await safeProgress({ step: 'starting', progress: 5, message: 'Vaš zahtjev je započeo s obradom...' });

        // The call to the pipeline is the same, but it will return a different structure.
        const finalResult = await runCourtAnalysis(searchTerm, 2, safeProgress); // We can make `2` a parameter later

        // --- NEW: Construct the optimized final payload ---
        const finalPayload = {
          // We now have an array of processed cases
          processedCases: finalResult.processedCases.map(pCase => ({
            caseResult: { // Keep case info lean
              title: pCase.caseResult.title,
              caseNumber: pCase.caseResult.caseNumber,
              court: pCase.caseResult.court,
              date: pCase.caseResult.date,
              detailLink: pCase.caseResult.detailLink,
              participants: pCase.caseResult.participants,
            },
            // Send back simplified file info, including the main download link
            files: pCase.files.map(f => ({ url: f.url, text: f.text })),
            // The individual analyses for this specific case entry
            analysis: {
              individualAnalyses: pCase.analysis.individualAnalyses.map(indAn => ({
                fileName: indAn.text,
                aiResult: indAn.aiResult,
                error: indAn.error
              }))
            }
          })),
          // The new top-level comparative analysis
          comparativeAnalysis: finalResult.comparativeAnalysis
        };

        //console.log('Final payload constructed:', finalPayload);
        //console.log('Participants:', finalPayload.processedCases.map(p => p.caseResult.participants));

        const sanitizedResult = sanitizeMarkdown(finalResult.comparativeAnalysis || '');
        finalPayload.comparativeAnalysis = sanitizedResult;
        if (isAuthed) {
          await completeAnalysisRun({
            supabase: req.supabase,
            analysisId: analysisRun.id,
            resultText: sanitizedResult,
          });
        } else {
          await completeTrialRun({
            supabaseAdmin,
            trialRunId: trialRun.id,
            resultText: sanitizedResult,
          });
        }

        await safeProgress({
          step: 'complete',
          progress: 100,
          message: 'Analiza je završena!',
          data: finalPayload // Send the new payload structure.
        });

      } catch (error) {
        console.error('[Court Analysis Queue] Pipeline error:', error);
        // If the pipeline fails, send a structured error message to the user.
        if (isAuthed && analysisRun?.id) {
          await appendAnalysisEvent({
            supabase: req.supabase,
            analysisId: analysisRun.id,
            eventType: 'error',
            message: error.message || 'Došlo je do greške u obradi.',
            metadata: {},
          }).catch((err) => {
            console.error('[Analysis Events] Failed to persist error event:', err.message);
          });

          await failAnalysisRun({
            supabase: req.supabase,
            analysisId: analysisRun.id,
            errorMessage: error.message || 'Došlo je do greške u obradi.',
          }).catch((err) => {
            console.error('[Analysis Runs] Failed to mark error:', err.message);
          });
        }

        if (!isAuthed && trialRun?.id) {
          await appendTrialEvent({
            supabaseAdmin,
            trialRunId: trialRun.id,
            eventType: 'error',
            message: error.message || 'Došlo je do greške u obradi.',
            metadata: {},
          }).catch((err) => {
            console.error('[Trial Events] Failed to persist error event:', err.message);
          });

          await failTrialRun({
            supabaseAdmin,
            trialRunId: trialRun.id,
            errorMessage: error.message || 'Došlo je do greške u obradi.',
          }).catch((err) => {
            console.error('[Trial Runs] Failed to mark error:', err.message);
          });
        }

        progressCallback({
          step: 'error',
          progress: 100,
          message: error.message || 'Došlo je do greške u obradi.'
        });
      } finally {
        // --- Step 4: Close the connection for this user ---
        // This runs whether the job succeeded or failed, ensuring the connection is always closed.
        if (!res.writableEnded) {
          res.end();
        }
        console.log(`[Court Analysis Queue] Stream closed for search term: ${searchTerm}`);
      }
    });

    // --- Optional but Recommended: Handle user disconnection ---
    // If the user closes their browser tab while their request is waiting in the queue,
    // this will log it. The `writableEnded` check above prevents errors.
    req.on('close', () => {
      console.log(`[Court Analysis Queue] Client disconnected while waiting or processing term: ${searchTerm}`);
    });
  });

  app.get('/api/analysis/runs', analysisReadIpLimiter, requireSupabaseAuth, analysisReadUserLimiter, async (req, res) => {
    try {
      const { limit, offset } = parsePagination(req.query);
      const result = await listAnalysisRuns({
        supabase: req.supabase,
        limit,
        offset,
      });
      res.json({ runs: result.data, count: result.count, limit, offset });
    } catch (error) {
      console.error('[Analysis Runs] list failed:', error.message);
      res.status(500).json({ error: 'Failed to load analysis runs.' });
    }
  });

  app.get('/api/analysis/runs/:id', analysisReadIpLimiter, requireSupabaseAuth, analysisReadUserLimiter, async (req, res) => {
    try {
      const run = await getAnalysisRun({
        supabase: req.supabase,
        id: req.params.id,
      });
      res.json({ run });
    } catch (error) {
      console.error('[Analysis Runs] get failed:', error.message);
      res.status(404).json({ error: 'Analysis run not found.' });
    }
  });

  app.get('/api/analysis/runs/:id/full', analysisReadIpLimiter, requireSupabaseAuth, analysisReadUserLimiter, async (req, res) => {
    try {
      const result = await getAnalysisRunFull({
        supabase: req.supabase,
        id: req.params.id,
      });
      res.json({
        run: result.run,
        events: result.events,
        server_time: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[Analysis Runs] get full failed:', error.message);
      res.status(404).json({ error: 'Analysis run not found.' });
    }
  });

  app.get('/api/analysis/runs/:id/events', analysisReadIpLimiter, requireSupabaseAuth, analysisReadUserLimiter, async (req, res) => {
    try {
      const events = await getAnalysisEvents({
        supabase: req.supabase,
        analysisId: req.params.id,
      });
      res.json({ events });
    } catch (error) {
      console.error('[Analysis Events] get failed:', error.message);
      res.status(404).json({ error: 'Analysis events not found.' });
    }
  });

  const analysisRunStreamHandler = createAnalysisRunStreamHandler({
    getAnalysisRunFull,
    buildSseEvent,
    isTerminalStatus,
    buildCursor,
    didRunChange,
    getNewEvents,
    shouldStartStreamTimers,
    streamPollMs: 1500,
    heartbeatMs: 25000,
  });
  app.get('/api/analysis/runs/:id/stream', analysisReadIpLimiter, requireSupabaseAuth, analysisReadUserLimiter, analysisRunStreamHandler);

  app.post('/api/trial/claim', requireSupabaseAuth, async (req, res) => {
    const trialId = req.signedCookies?.[trialCookieName];
    if (!trialId) {
      return res.json({ claimed: false, migrated: 0 });
    }

    let supabaseAdmin = req.supabaseAdmin || null;
    try {
      supabaseAdmin = supabaseAdmin || getSupabaseAdminClient();
    } catch (err) {
      console.error('[Trial] Supabase admin unavailable:', err.message);
      return res.status(503).json({ error: 'Trial flow unavailable.' });
    }

    try {
      const trialRuns = await getTrialRuns({ supabaseAdmin, trialId });
      if (trialRuns.length === 0) {
        clearTrialCookie(res);
        return res.json({ claimed: false, migrated: 0 });
      }

      let migrated = 0;
      for (const trialRun of trialRuns) {
        const { data: insertedRun, error } = await supabaseAdmin
          .from('analysis_runs')
          .insert({
            user_id: req.user.id,
            oib: trialRun.oib,
            status: trialRun.status,
            result_text: trialRun.result_text,
            result_format: trialRun.result_format,
            error: trialRun.error,
            created_at: trialRun.created_at,
            completed_at: trialRun.completed_at,
          })
          .select('*')
          .single();

        if (error) {
          throw new Error(`Failed to migrate trial run: ${error.message}`);
        }

        const events = await getTrialEvents({ supabaseAdmin, trialRunId: trialRun.id });
        if (events.length > 0) {
          const payload = events.map((event) => ({
            analysis_id: insertedRun.id,
            event_type: event.event_type,
            message: event.message,
            metadata: event.metadata,
            created_at: event.created_at,
          }));
          const { error: eventsError } = await supabaseAdmin
            .from('analysis_events')
            .insert(payload);
          if (eventsError) {
            throw new Error(`Failed to migrate trial events: ${eventsError.message}`);
          }
        }

        migrated += 1;
      }

      await deleteTrialData({ supabaseAdmin, trialId });
      clearTrialCookie(res);

      return res.json({ claimed: true, migrated });
    } catch (error) {
      console.error('[Trial] Claim failed:', error.message);
      return res.status(500).json({ error: 'Failed to claim trial runs.' });
    }
  });


  app.post('/api/subscribe', async (req, res) => {
    const { email, searchTerm } = req.body;

    if (!email || !searchTerm) {
      console.log('Subscribe failed: Missing email or searchTerm', { email: !!email, searchTerm: !!searchTerm });
      return res.status(400).json({ error: 'Email and search term are required.' });
    }

    try {
      const result = await db.query(
        'INSERT INTO subscriptions (email, search_term) VALUES ($1, $2) RETURNING id',
        [email, searchTerm]
      );

      console.log(`Subscribe success: ${email} -> "${searchTerm}" (ID: ${result.rows[0].id})`);
      res.status(201).json({
        success: true,
        message: 'Successfully subscribed!',
        subscriptionId: result.rows[0].id
      });

    } catch (error) {
      // Log the actual error details for debugging
      console.error('Subscribe error:', {
        email,
        searchTerm,
        errorCode: error.code,
        errorMessage: error.message,
        errorDetail: error.detail,
        constraint: error.constraint
      });

      if (error.code === '23505') { // Unique violation
        return res.status(409).json({ error: 'This email is already subscribed to this search term.' });
      }

      res.status(500).json({ error: 'Failed to subscribe.' });
    }
  });

  // Add an unsubscribe endpoint for good measure (and legal compliance!)
  app.get('/api/unsubscribe/:token', async (req, res) => {
    const { token } = req.params;
    try {
      await db.query('UPDATE subscriptions SET is_active = FALSE WHERE unsubscribe_token = $1', [token]);
      // You'd probably want to serve a nice HTML page here
      res.send('You have been successfully unsubscribed.');
    } catch (error) {
      console.error('Unsubscribe error:', error);
      res.status(500).send('Could not process unsubscribe request.');
    }
  });

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(500).json({ error: err.message });
    }
    next();
  });

  const server = app.listen(port, host, () => {
    console.log(`Gemini server running on ${host}:${port}`);
  });
  server.on('error', (error) => {
    console.error('[Startup] Server listen failed:', error);
    process.exit(1);
  });

} // End of the async startServer function


// ========= CHANGE 5: CALL THE FUNCTION TO START THE SERVER =========
// It's good practice to catch any errors during startup.
startServer().catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
