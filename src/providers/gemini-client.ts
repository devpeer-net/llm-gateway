import OpenAI from 'openai';

export const isConfigured = Boolean(process.env.GEMINI_API_KEY);

if (!process.env.GEMINI_API_KEY) {
  if (process.env.NODE_ENV !== 'test') {
    console.error('GEMINI_API_KEY environment variable is not set');
  }
  process.env.GEMINI_API_KEY = 'test_key';
}

const geminiAI = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

export default geminiAI;
