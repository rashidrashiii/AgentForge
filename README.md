# AgentForge (Alpha)

AgentForge is an autonomous AI-Agent based Web App Generator. It leverages the power of Large Language Models (LLMs) to scaffold, generate, and deploy full-stack web applications based on user prompts.

## 🚀 Why it started

This project started as an exploration into building agentic workflows using **NestJS** and **Mastra** (and previously LangChain). The goal was to create a system where a user could simply describe an idea (e.g., "Build me a todo app"), and the agent would handle the complexity of:
1.  **Planning**: Breaking down the app into components and database schemas.
2.  **Coding**: Generating the actual code for the frontend (Next.js) and backend.
3.  **Refining**: Iterating on the design and logic.

## 🚧 Status

**Current Status:** 🏗️ **Work in Progress / Alpha**

The core agentic loop is functional, but the project is not yet fully complete.
- **What works**:
    - The agent structure and basic workflow.
    - Integration with Gemini/OpenAI models.
    - Basic project scaffolding logic.
- **What is missing/needs work**:
    - Robust error handling in code generation.
    - More comprehensive frontend template support.
    - Full end-to-end testing of generated apps.

## 🛠️ Tech Stack

- **Backend / Agent**: NestJS, Mastra, LangChain, Supabase (for persistence).
- **Frontend (Generated Apps)**: Next.js, TailwindCSS (via styling prompt), Lucide React.
- **LLMs**: Google Gemini, OpenAI.

## 📦 How to Use

### Prerequisites

- Node.js (v20+)
- pnpm or npm
- A Supabase project (for agent memory/state).
- API Keys for Google Gemini or OpenAI.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/rashidrashiii/AgentForge.git
    cd agent-forge
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Setup Environment:**
    Copy `.env.example` (if available) or create a `.env` file based on the config service requirements:
    ```env
    # Example
    OPENAI_API_KEY=sk-...
    GEMINI_API_KEY=...
    SUPABASE_URL=...
    SUPABASE_KEY=...
    ```

4.  **Run the Agent Server:**
    ```bash
    npm run start:dev
    ```

5.  **Setup Client Environment:**
    Navigate to the `client` directory and create a `.env.local` file:
    ```bash
    cd client
    cp .env.example .env.local
    ```
    Fill in the user details:
    ```env
    NEXT_PUBLIC_SUPABASE_URL=...
    NEXT_PUBLIC_SUPABASE_ANON_KEY=...
    NEXT_PUBLIC_API_URL=http://localhost:3000
    ```

6.  **Run the Client:**
    ```bash
    # In a new terminal
    cd client
    npm run dev
    ```

(Note: Actual usage depends on the current API endpoints exposed by the `AgentController`. Typically, you would send a POST request to the agent endpoint with your prompt.)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

[MIT](LICENSE)
