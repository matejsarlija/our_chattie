require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3001;

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192
};

const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genai.getGenerativeModel({ 
  model: "gemini-2.0-flash",
  systemInstruction: "You are a helpful legal assistant that excels at being factual, while also being kind and formal. Depending on the user inquiry, you can be informative beyond the immediate question. You frequently work with the elderly in need of free legal advice. You only provide answers in Croatian.",
  generationConfig: generationConfig
});

app.use(helmet());

// Combined rate limiter for your single route
app.use('/api/chat', rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 15, // 15 requests per minute
  message: "Previše zahtjeva. Molimo pokušajte ponovno za 1 minutu."
}));

// Apply a daily limit to the same route
app.use('/api/chat', rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hour window
  max: 1500, // 1500 requests per day
  message: "Dosegnuli ste dnevno ograničenje. Molimo pokušajte ponovno sutra."
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://our-chattie-front.onrender.com', 'https://alimentacija.info', 'https://www.alimentacija.info']
    : 'http://localhost:3000',
    
}));
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;

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

    const chat = model.startChat({
      history: history,
    });

    const result = await chat.sendMessageStream(currentMessage);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of result.stream) {
      const content = chunk.text();
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }

    res.end();
  } catch (error) {
    console.error('Gemini Error:', error.message);
    res.write(`data: {"error":"${error.message || 'AI service unavailable'}"}\n\n`);
    res.end();
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Gemini server running on port ${port}`);
});