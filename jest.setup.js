// Jest setup: configure a deterministic test environment.
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test_key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test_key';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test_key';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AUTH_MODE = process.env.AUTH_MODE || 'none';
process.env.QUOTA_STORE = process.env.QUOTA_STORE || 'memory';
