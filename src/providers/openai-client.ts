import { OpenAI } from 'openai';

if (!process.env.OPENAI_API_KEY) {
  if (process.env.NODE_ENV !== 'test') {
    console.error('OPENAI_API_KEY environment variable is not set');
  }
  process.env.OPENAI_API_KEY = 'test_key';
}

const openAI = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default openAI;
