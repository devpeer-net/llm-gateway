import OpenAI from 'openai';

export const isConfigured = Boolean(process.env.OPENROUTER_API_KEY);

if (!process.env.OPENROUTER_API_KEY) {
  if (process.env.NODE_ENV !== 'test') {
    console.error('OPENROUTER_API_KEY environment variable is not set');
  }
  process.env.OPENROUTER_API_KEY = 'test_key';
}

const openRouterAPI = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

export default openRouterAPI;
