# GEMINI.md

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
