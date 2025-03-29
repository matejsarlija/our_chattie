require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3001;

// Configure multer for file uploads
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
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif'];
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
    fileSize: 5 * 1024 * 1024 // Limit file size to 10MB
  }
});

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192
};

const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GOOGLE_API_KEY);
const model = genai.getGenerativeModel({ 
  model: "gemini-2.0-flash",
  systemInstruction: "You are a helpful legal assistant that excels at being factual, while also being kind and formal. Depending on the user inquiry, you can be informative beyond the immediate question. You frequently work with the elderly in need of free legal advice. You only provide answers in Croatian.",
  generationConfig: generationConfig
});

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

// Helper function to upload file to Google AI File Manager
async function uploadFileToGoogleAI(filePath, originalFilename) {
  try {
    const mimeType = path.extname(filePath).toLowerCase() === '.pdf' 
      ? 'application/pdf' 
      : `image/${path.extname(filePath).substring(1).toLowerCase()}`;
    
    const fileBuffer = fs.readFileSync(filePath);
    const fileBlob = fileBuffer
    
    const uploadResult = await fileManager.uploadFile(fileBlob, {
      mimeType: mimeType,
      displayName: originalFilename || path.basename(filePath)
    });

    console.log(`Uploaded file ${uploadResult.file.displayName} as: ${uploadResult.file.uri}`);
    
    // Poll to check if file processing is complete
    let file = await fileManager.getFile(uploadResult.file.name);
    
    // Initially wait for processing to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check processing status
    while (file.state === 'PROCESSING') {
      process.stdout.write(".");
      // Sleep for 3 seconds
      await new Promise(resolve => setTimeout(resolve, 3000));
      // Fetch the file from the API again
      file = await fileManager.getFile(uploadResult.file.name);
    }
    
    if (file.state === 'FAILED') {
      throw new Error("File processing failed.");
    }
    
    return {
      fileUri: uploadResult.file.uri,
      mimeType: uploadResult.file.mimeType
    };
  } catch (error) {
    console.error('Error uploading file to Google AI:', error);
    throw error;
  }
}

// Modified chat endpoint to handle file uploads
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

    const geminiMessages = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content || '' }]
    }));

    if (geminiMessages.length === 0 || geminiMessages[0].role !== 'user') {
      throw new Error("Conversation must start with a user message");
    }

    let history = [];
    let currentMessage = '';

    if (geminiMessages.length > 1) {
      history = geminiMessages.slice(0, -1);
      currentMessage = geminiMessages[geminiMessages.length - 1].parts[0].text;
    } else {
      currentMessage = geminiMessages[0].parts[0].text;
    }

    if (!currentMessage || currentMessage.trim() === '') {
      console.error('Empty currentMessage:', geminiMessages);
      throw new Error("Current message cannot be empty");
    }

    // Create parts array for the message
    let messageParts = [{ text: currentMessage }];
    
    // Handle uploaded file if present
    if (req.file) {
      uploadedFilePath = req.file.path;
      const fileType = req.file.mimetype.includes('pdf') ? 'PDF' : 'image';
      
      // Upload file to Google AI File Manager
      const { fileUri, mimeType } = await uploadFileToGoogleAI(
        req.file.path, 
        req.file.originalname
      );
      
      // Add file to message parts
      messageParts.push({
        fileData: {
          fileUri: fileUri,
          mimeType: mimeType
        }
      });
      
      // Update text to include reference to the file
      messageParts[0].text += `\n\n(Attached ${fileType}: ${req.file.originalname})`;
    }

    const chat = model.startChat({
      history: history,
    });

    // Send message with parts (text and file if present)
    const result = await chat.sendMessageStream(messageParts);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of result.stream) {
      const content = chunk.text();
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
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
    console.error('Gemini Error:', error.message);
    
    // Clean up the uploaded file in case of error
    if (uploadedFilePath) {
      fs.unlink(uploadedFilePath, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }
    
    res.write(`data: ${JSON.stringify({ error: error.message || 'AI service unavailable' })}\n\n`);
    res.end();
  }
});

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