require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3001;

// Initialize Google Gemini client
const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genai.getGenerativeModel({ model: "gemini-1.5-pro" }); // You can change to other Gemini models like "gemini-1.0-pro"

// Security middleware
app.use(helmet());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? 'https://your-production-domain.com' 
    : 'http://localhost:3000'
}));
app.use(express.json());

// Streaming endpoint for Gemini
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    
    // Convert messages to Gemini format (it expects a different structure)
    const geminiMessages = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const chat = model.startChat({
      history: geminiMessages.slice(0, -1), // All but the last message as history
    });

    const lastMessage = geminiMessages[geminiMessages.length - 1].parts[0].text;

    // Gemini streaming response
    const result = await chat.sendMessageStream(lastMessage, {
      temperature: 0.7,
      maxOutputTokens: 1024,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of result.stream) {
      const content = chunk.text();
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }

    res.end();
  } catch (error) {
    console.error('Gemini Error:', error);
    res.write('data: {"error":"AI service unavailable"}\n\n');
    res.end();
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Gemini server running on port ${port}`);
});