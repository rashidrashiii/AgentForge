# Provider Switching Guide

The `LlmService` is designed to be agnostic to the specific LLM model, utilizing the OpenAI SDK which is compatible with many providers (OpenAI, OpenRouter, DeepSeek, generic local endpoints).

## Changing Models

1.  Open `.env`.
2.  Update the `DEFAULT_MODEL` variable.
    ```env
    DEFAULT_MODEL=deepseek/deepseek-coder
    ```

## Adding New Providers (e.g., Local Ollama)

If you want to use a provider that isn't OpenRouter:

1.  **Update `.env`**:
    ```env
    OPENAI_BASE_URL=http://localhost:11434/v1
    OPENAI_API_KEY=ollama
    DEFAULT_MODEL=llama3
    ```
2.  **Code Adjustments** (if needed):
    - The `LlmService` reads `BASE_URL` from configuration. Ensure your configuration loading logic in `src/config/configuration.ts` captures this.
    - Currently, it defaults to `https://openrouter.ai/api/v1` if not provided.

## Configuration File (`src/config/configuration.ts`)

Ensure the `llm` config object includes `baseUrl`:

```typescript
export default () => ({
  llm: {
    apiKey: process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
    model: process.env.DEFAULT_MODEL || 'google/gemini-2.0-pro-exp:free',
  },
});
```
