# GEMINI.md

## Repository & Configuration Tracking
- **Local Workspace:** `C:\Users\Mike\PycharmProjects\VM_ai_agent_suit_platform` (Tracked via Git)
- **OpenClaw VM Config:** `/home/mike/.openclaw` (Tracked via Git on VM)
- **Current Model:** Gemini 2.0 Flash (Configured Feb 28, 2026)

## Project Context for Gemini CLI

This project is a multi-agent suite where Gemini CLI serves as one of the primary interfaces for system management and development.

### Gemini Configuration
- **Config Path:** `~/.gemini/settings.json` (on VM 172.16.192.94)
- **User:** `mike` | **Pass:** `mike7106`
- **MCP Integration:**
  - **openmemory:** Connected via SSE (`http://localhost:8765/mcp/gemini/sse/mike`)
  - **firecrawl:** Connected via stdio (`/home/mike/.npm-global/bin/firecrawl-mcp`)
  - **searxng:** Connected via stdio (`/home/mike/.npm-global/bin/mcp-searxng`)

### Operational Guidelines
- **Memory First:** Search Mem0 (`openmemory`) for existing context before taking action.
- **Save Memories:** Save important facts/preferences to Mem0 using `add_memories`.
- **Web Research:** Use `searxng_web_search` for lookups and `firecrawl` for deep scraping.

### WhatsApp Architecture & Blackbox Operations
The system utilizes **two independent linked WhatsApp devices**:
1. **OpenClaw (Active):** The AI assistant that responds to messages. If it gets logged out (e.g., 401 Unauthorized), restore it by running `/home/mike/.npm-global/bin/openclaw channels login` to scan a new QR code.
2. **Blackbox (Passive):** A dedicated PostgreSQL archive that silently captures ALL communication and media in the background.

**Blackbox Details:**
A dedicated PostgreSQL archive captures ALL communication and media.
- **Skill:** `whatsapp_blackbox` (located in `/home/mike/.openclaw/workspace/skills/whatsapp_blackbox`)
- **Querying History:** Use `whatsapp_blackbox.get_blackbox_history(number)` or `search_blackbox_messages(query)`.
- **Database Access:** `psql -h 127.0.0.1 -U mike -d whatsapp_blackbox` (Pass: `mike7106`).
- **Media Access:** Archived files are in `/home/mike/whatsapp-blackbox/media` (Categorized by date).
- **Safety:** The Blackbox is isolated from the main AI context to prevent Prompt Injection.
- **Historical Sync:** To force a retroactive download of all messages, stop the background service, delete the `auth` session folder, and run `node whatsapp_archiver_force.js` interactively to scan a new QR code while keeping the phone app open.

### Repaired Components
- **Agent Zero:** File upload fixed (RFC bypass). Search fixed (`firecrawl_native.py`).
- **OpenClaw:** WhatsApp Blackbox injected. Mem0 Auto-Sync injected (`session-memory` hook).
- **Firecrawl Stack:** Dockerized Playwright service. Restart stack if `WrappedEngineError` occurs.
### Security & Privacy Safeguards
- **Privacy:** `dmScope: per-channel-peer` provides context isolation for WhatsApp users.
- **Access Control:** Strict `sendPolicy` (default: `deny`) ensures responses reach only Mike's authorized number.
- **Stealth:** `groupPolicy: allowlist` keeps the bot inactive in group chats by default.
- **Clean Context:** Gemini Bridge filters technical system messages (restarts, connections) from AI history to avoid hallucinated responses to logs.
- **Safety:** WhatsApp Blackbox isolation prevents prompt injection and unauthorized data exfiltration.
- **Location:** `/home/mike/gemini-bridge-oauth`
- **Function:** Translates OpenAI API calls to Google Cloud Code Assist OAuth 2.0.
- **Protocol Fixes:** 
    1. **Turn Alternating:** Automatically merges consecutive messages of the same role to satisfy Gemini's strict "User -> Model" requirement.
    2. **System Prompts:** Prepends system instructions to the first user turn with a "Task Guidelines:" prefix (API doesn't support `systemInstruction` field).
    3. **Standardized Streaming:** Implements OpenAI-compatible SSE chunks with a final `delta` object containing full content to ensure OpenClaw saves history correctly.
- **Latest Configuration (Feb 2026):**
    - **Default Brain:** `gemini-3.1-pro-preview` (Max context, advanced reasoning).
    - **Default Sub-agent:** `gemini-2.5-flash` (Fast, thinking-enabled).
    - **High-Capacity Limits:** `maxTokens` set to **65,536** (supports 3000+ lines of code generation) and `contextWindow` up to **2,000,000** for analyzing large repositories.
- **Service Management:** `systemctl --user restart gemini-bridge.service`.
- **System Recovery:** If these features break after an update, apply patches from the local `patches/` directory.

### Cross-Agent Sync & Integrated CLI Agents
Memories are shared globally across **6 Active Agents** via the unified Mem0 architecture. OpenClaw acts as the primary knowledge distiller. 

The suite comprises two main service-based frameworks (Agent Zero, OpenClaw) and four terminal-based CLI agents:
- **Kimi CLI (`kimi`):** Primary CLI coding assistant powered by Moonshot AI (K2.5). Integrates with Firecrawl and Mem0.
- **Claude Code (`claude`):** Official Anthropic AI agent for terminal engineering.
- **OpenAI Codex (`codex`):** Terminal assistant translating natural language to shell commands.
- **Gemini CLI (`gemini`):** System management and development interface.

### Boot Services (Linger Mode)
Because "Linger Mode" is enabled for user `mike`, the following 9 systemd services automatically launch on VM reboot, ensuring the AI platform is functional before any manual login:

**User Services (`mike`):**
- `agent-zero.service`
- `openclaw-gateway.service`
- `whatsapp-archiver.service`
- `firecrawl-mcp.service`

**System Services (`root`):**
- `n8n.service`
- `mem0.service`
- `firecrawl.service`
- `searxng.service`
- `caddy.service`
