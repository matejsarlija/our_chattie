// Keep all your original CommonJS require() statements at the top
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { handleChatMessage } = require('./chatAgent'); // Import the chat service
const { CourtSearchPuppeteer } = require('./scraper/courtSearchPuppeteer');
const rateLimiter = require('./court-analysis/utils/rateLimiter');
const { runCourtAnalysis } = require('./court-analysis/pipeline');

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
  const app = express();
  const port = process.env.PORT || 3001;
  const courtAnalysisQueue = new PQueue({ concurrency: 1 }); // This should work now

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
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
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

  // CORS settings
  app.use(cors({
    origin: process.env.NODE_ENV === 'production'
      ? ['https://our-chattie-front.onrender.com', 'https://alimentacija.info', 'https://www.alimentacija.info']
      : 'http://localhost:3000',
  }));

  app.use(express.json());

  // Chat endpoint with proper streaming format
  app.post('/api/chat', upload.single('file'), async (req, res) => {
    let uploadedFilePath = null;

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

      try {
        for await (const chunk of result.stream) {
          const content = chunk.content || chunk.text || chunk;
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
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

  app.post('/api/court-analysis', (req, res) => {
    const { searchTerm } = req.body;

    if (!searchTerm) {
      return res.status(400).json({ error: 'Search term is required' });
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

      // Define the progress callback INSIDE the queued job.
      // This is crucial because it gives the job access to this specific user's `res` object.
      const progressCallback = (data) => {
        // Safety check: Don't try to write to a connection that the user has already closed.
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      try {
        // Let the user know their job has moved from "waiting" to "processing".
        progressCallback({ step: 'starting', progress: 5, message: 'Vaš zahtjev je započeo s obradom...' });

        // Run the main, resource-intensive pipeline.
        const finalResult = await runCourtAnalysis(searchTerm, progressCallback);

        // --- Step 3: Create a smaller, optimized payload for the final event ---
        // This prevents the "Unterminated string in JSON" error by removing the huge, unused 'content' field.
        const finalPayload = {
          caseResult: {
            title: finalResult.caseResult.title,
            caseNumber: finalResult.caseResult.caseNumber,
            court: finalResult.caseResult.court,
            date: finalResult.caseResult.date,
            link: finalResult.caseResult.link,
            documentLinks: finalResult.caseResult.documentLinks,
            hasDocuments: finalResult.caseResult.hasDocuments
            // We are deliberately OMITTING the huge `finalResult.caseResult.content` field.
          },
          // Send back only essential file info, not the local server path.
          files: finalResult.files.map(f => ({ url: f.url, text: f.text })),
          analysis: finalResult.analysis
        };

        // Send the final, successful result to the user.
        progressCallback({
          step: 'complete',
          progress: 100,
          message: 'Analiza je završena!',
          data: finalPayload // Send the optimized payload.
        });

      } catch (error) {
        console.error('[Court Analysis Queue] Pipeline error:', error);
        // If the pipeline fails, send a structured error message to the user.
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

  app.listen(port, () => {
    console.log(`Gemini server running on port ${port}`);
  });

} // End of the async startServer function


// ========= CHANGE 5: CALL THE FUNCTION TO START THE SERVER =========
// It's good practice to catch any errors during startup.
startServer().catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});