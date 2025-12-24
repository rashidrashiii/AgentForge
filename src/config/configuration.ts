export default () => ({
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
  model: process.env.DEFAULT_MODEL || 'google/gemini-2.0-pro-exp:free',
  provider: process.env.LLM_PROVIDER || 'openrouter',
});
