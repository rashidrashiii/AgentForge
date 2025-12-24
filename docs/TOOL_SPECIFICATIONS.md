# Tool Specifications

The agent uses a set of robust tools to manipulate the project file system.

## Tool Definitions

### `edit_file`
-   **Purpose**: Update existing files with precise string replacements.
-   **Mechanism**: Read file -> Find `searchString` -> Replace with `replaceString` -> Write file.
-   **Benefits**:
    -   **Token Efficiency**: Avoids rewriting the entire file for small changes.
    -   **Security**: Prevents overwriting unrelated parts of the file.
-   **Usage**: Preferred for bug fixes, tweaks, and appending content.

### `write_file`
-   **Purpose**: Create new files or overwrite existing ones completely.
-   **Mechanism**: Write string content directly to the file path.
-   **Usage**: Used for initializing new components or pages.

### `read_file`
-   **Purpose**: Retrieve the content of a specific file.
-   **Usage**: The agent uses this to understand the current implementation before making changes.

### `list_files`
-   **Purpose**: Get a recursive list of all files in the project (excluding `node_modules` and `.git`).
-   **Usage**: Provides context to the agent about the project structure.

### `delete_file`
-   **Purpose**: Remove a file.
-   **Usage**: Cleanup or restructuring.
