require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Groq } = require('groq-sdk');  // Changed import syntax

const app = express();
const port = process.env.PORT || 3001;

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

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

// Streaming endpoint for Groq
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    
    const stream = await groq.chat.completions.create({
      model: "mixtral-8x7b-32768", // Groq model name
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      stream: true
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }

    res.end();
  } catch (error) {
    console.error('Groq Error:', error);
    res.write('data: {"error":"AI service unavailable"}\n\n');
    res.end();
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Groq server running on port ${port}`);
});