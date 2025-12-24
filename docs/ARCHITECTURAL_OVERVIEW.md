# Architectural Overview

This document explains the high-level architecture of the AI UI Generator Agent.

## System Flow

1.  **User Prompt**: The user submits a prompt via the `POST /chat/generate` endpoint.
2.  **Context Loading**:
    - The `ChatController` receives the request.
    - It loads existing chat history from the `PersistenceService`.
    - It initializes the project workspace if it doesn't exist via `WorkspaceService`.
3.  **Agent Loop (`AgentService`)**:
    - The `runAgent` method is called with the session ID and prompt.
    - **System Prompt**: A specialized prompt (`UI_GENERATOR_SYSTEM_PROMPT`) sets the persona (Senior Frontend Engineer) and constraints (Tailwind, Lucide).
    - **Context**: The current file list is appended to the system prompt.
    - **LLM Interaction**: The agent sends messages to the LLM (via `LlmService`).
    - **Tool Execution**: If the LLM requests a tool (e.g., `write_file`, `edit_file`), the `AgentService` executes it using the `WorkspaceService` and feeds the result back to the LLM.
    - **Loop**: This continues until the LLM provides a final text response or the max step limit is reached.
4.  **File System**: Changes are reflected real-time in the `projects/{sessionId}` directory.
5.  **Preview**: The frontend can fetch the generated files via `GET /preview/{sessionId}/*`, effectively serving the Next.js app.

## Core Services

-   **LlmService**: Handles communication with the AI provider (OpenRouter).
-   **WorkspaceService**: Manages file system operations (read, write, list, delete, edit) with path traversal protection.
-   **AgentService**: Orchestrates the reasoning loop and tool execution.
-   **PersistenceService**: Stores chat history in-memory.
