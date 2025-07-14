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
const PQueue = require('p-queue').default;

const app = express();
const port = process.env.PORT || 3001;
const courtAnalysisQueue = new PQueue({ concurrency: 5 }); // Adjust concurrency as needed

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

    // Parse messages if they come as a string (from form data)
    if (typeof messages === 'string') {
      messages = JSON.parse(messages);
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new Error("No messages provided");
    }

    // Store file info for cleanup
    uploadedFilePath = req.file?.path;

    console.log('Chat request:', { 
      messageCount: messages?.length, 
      hasFile: !!uploadedFilePath,
      messagesType: typeof messages,
      firstMessage: messages?.[0]
    });

    // Call the LangChain chat handler
    const result = await handleChatMessage({
      messages: messages,
      filePath: uploadedFilePath,
      originalFilename: req.file?.originalname
    });

    // Set up streaming response headers (same format as working version)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream the response in the expected format
    try {
      for await (const chunk of result.stream) {
        // LangChain streams return the content directly
        const content = chunk.content || chunk.text || chunk;
        if (content) {
          // Format as Server-Sent Events like the working version
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
    } catch (streamError) {
      console.error('Streaming error:', streamError);
      res.write(`data: ${JSON.stringify({ error: 'Streaming failed' })}\n\n`);
    }

    // Clean up the uploaded file after processing
    if (uploadedFilePath) {
      fs.unlink(uploadedFilePath, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
      uploadedFilePath = null;
    }

    res.end();

  } catch (error) {
    console.error('Chat error:', error);

    // Clean up the uploaded file in case of error
    if (uploadedFilePath) {
      fs.unlink(uploadedFilePath, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }

    // Send error in the same format as working version
    res.write(`data: ${JSON.stringify({ error: error.message || 'AI service unavailable' })}\n\n`);
    res.end();
  }
});

app.post('/api/court-search', async (req, res) => {
    try {
        const { searchTerm, searchType = 'oib' } = req.body;
        
        // Your existing scraper logic here
        const automator = new CourtSearchPuppeteer();
        await automator.init();
        
        const results = await automator.performSearch(searchTerm);
        
        // Get most recent case per case number (first one since sorted newest→oldest)
        const latestCases = getLatestCases(results.results);
        
        // Download and analyze files
        const analyzedCases = await analyzeCourtCases(latestCases);
        
        await automator.close();
        
        res.json({
            success: true,
            cases: analyzedCases,
            totalFound: results.results.length,
            processedCases: analyzedCases.length
        });
        
    } catch (error) {
        console.error('Court search error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add rate limiter for court analysis endpoint
app.use('/api/court-analysis', rateLimiter);

// Concurrency-limited court analysis endpoint
app.post('/api/court-analysis', async (req, res) => {
  try {
    const { searchTerm } = req.body;
    await courtAnalysisQueue.add(async () => {
      // You can add progressCallback logic here if needed
      const result = await runCourtAnalysis(searchTerm, progress => {
        // Optionally stream progress via SSE or log
      });
      res.json(result);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // A Multer error occurred when uploading
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  } else if (err) {
    // An unknown error occurred
    return res.status(500).json({ error: err.message });
  }
  next();
});

app.listen(port, () => {
  console.log(`Gemini server running on port ${port}`);
});