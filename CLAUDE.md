# CLAUDE.md

## Project Overview
VM AI Agent Suite Platform - A comprehensive AI agent orchestration platform coordinating multiple agents for programming, automation, life optimization, and wealth generation.

## Repository & Configuration Tracking
- **Local Repo:** `C:\Users\Mike\PycharmProjects\VM_ai_agent_suit_platform` (Tracked via Git)
- **OpenClaw VM Config:** `/home/mike/.openclaw` (Tracked via Git on VM)
- **Current Model:** Gemini 3.1 Pro Preview via OAuth Bridge (Configured Mar 1, 2026)

## Tech Stack & Environment
- **Host VM 1 (Main):** 172.16.192.94 (Pop!_OS 24.04, 64GB RAM)
- **Host VM 2 (UbuntuLLM):** 172.16.0.118 (Ubuntu, 2x GPU — LM Studio inference server)
- **User:** `mike` | **Password:** `mike7106` (Unified for SSH, Web UI, and DB)
- **Language:** Python 3.12, Node.js 22
- **Infrastructure:** Docker Compose, Systemd (User & System services)
- **AI Routing:** All AI calls go through Gemini Bridge (OAuth) → Gemini API, with LM Studio fallback

## Service Architecture

### AI Agents & Gateways
| Service | Purpose | Port | URL | Management |
|---------|---------|------|-----|------------|
| **Agent Zero** | Main AI framework | :5000 | `https://172.16.192.94:5001` | systemd user: `agent-zero.service` |
| **OpenClaw** | Active WhatsApp Gateway | :18789 | `https://172.16.192.94:18790` | systemd user: `openclaw-gateway.service` (To relink WhatsApp: `/home/mike/.npm-global/bin/openclaw channels login`) |
| **n8n** | Automation platform | :5678 | `https://172.16.192.94:5680` | systemd system: `n8n.service` |
| **Kimi CLI** | Coding Assistant | N/A | CLI: `kimi` | Global Binary |
| **Claude** | Anthropic Agent | N/A | CLI: `claude` | Global Binary (@anthropic-ai/claude-code) |
| **Codex** | OpenAI Code Agent | N/A | CLI: `codex` | Global Binary (@openai/codex) |
| **WhatsApp Blackbox**| Passive Archiver | N/A | Internal | systemd user: `whatsapp-archiver.service` |

### Shared Tools (MCP Servers)
| Service | Tooling | Transport | Port | URL | Notes |
|---------|---------|-----------|------|-----|-------|
| **Mem0** | Shared Memory | SSE | :8765 | `https://172.16.192.94:8766` | LLM via Bridge, embeddings via LM Studio nomic-embed-text. |
| **Firecrawl** | Web Scraper | HTTP Stream | :3008 | `https://172.16.192.94:3007` | **Node.js** version restored for Kimi. Agent Zero uses `firecrawl_native.py`. |
| **SearXNG** | Web Search | HTTP Stream | :8081 | `https://172.16.192.94:55511` | Rate limits unlocked. |
| **Gemini Bridge**| OAuth Bridge | HTTP (OpenAI) | :3458 | `http://172.16.192.94:3458`| Dual model chains, context compression, per-client cache. See `patches/gemini-bridge/README.md`. |

### LM Studio (UbuntuLLM — 172.16.0.118)
| Model | Type | Size | Context | Notes |
|-------|------|------|---------|-------|
| **Qwen3-Coder-30B-A3B** | Chat (MoE) | 17.5 GB | 1M | JIT loaded on first request. Bridge fallback. |
| **nomic-embed-text v1.5** | Embedding | 146 MB | 2048 | Always loaded. 768 dims. Used by Mem0. |
| **Qwen 3.5-35B-A3B** | Chat (MoE, thinking) | 22 GB | 4K+ | Available via JIT. Built-in `<think>` reasoning. |

- **API:** `http://172.16.0.118:1234` (OpenAI-compatible, auth disabled)
- **Managed by:** 3 systemd user services: `xvfb.service` → `lmstudio.service` → `lmstudio-server.service`
- **Patches:** `patches/lmstudio/` (systemd unit files)

## AI Model Routing

All AI agents use the **Gemini Bridge** as a unified OpenAI-compatible proxy. No direct API keys — everything through OAuth.

### Gemini Bridge (`patches/gemini-bridge/`)
- **Dual model chains:** Reasoning (pro models, thinking ON) and Subagent (flash/lite, thinking OFF)
- **Model fallback:** `gemini-3.1-pro-preview → gemini-3-flash-preview → gemini-2.5-pro → gemini-2.5-flash → gemini-2.5-flash-lite → LM Studio`
- **Context compression:** At 800K tokens, compresses to 400K via LM Studio (10/60/30 structure)
- **Per-client cache:** Isolated by `X-Client-Id` header or User-Agent fingerprint
- **pgvector snapshots:** Paired before/after compression stored for optimization (`bridge-db` container, port 5433)

### Agent Zero Model Slots (config only, no code changes)
| Slot | Model | Thinking | Purpose |
|------|-------|----------|---------|
| Chat | `gemini-3.1-pro-preview` | ON | Main reasoning, complex tasks |
| Utility | `gemini-2.5-flash-lite` | OFF | Memory, compression, summarization |
| Browser | `gemini-3-flash-preview` | OFF | Web page analysis, vision |
| Embedding | `all-MiniLM-L6-v2` | N/A | Local HuggingFace, no API |

- **Config:** `usr/settings.json` + `usr/.env` (provider: `other`, api_base: `http://127.0.0.1:3458/v1`)
- **Context:** 1M tokens, compresses at 850K (topic-based, utility model)

### Mem0 Architecture (`patches/mem0/`)
- **LLM:** Gemini Bridge (`gemini-2.5-flash-lite`) for fact extraction
- **Embedder:** LM Studio `nomic-embed-text v1.5` (768 dims) — local, no API key needed
- **Vector Store:** Qdrant (Docker, port 6333)
- **Config:** Stored in SQLite DB, managed via REST API (`PUT /api/v1/config/mem0/llm`, `/embedder`)
- **Patch:** `config.py` Pydantic schemas extended with `openai_base_url` + `embedding_dims` fields
- **Docker:** `extra_hosts: host.docker.internal` + UFW rules for container→Bridge access

## WhatsApp Architecture (Dual Session)
The system uses **two separate WhatsApp Web sessions** (both appearing as linked browsers on your phone):
1. **OpenClaw (Active):** Acts as the AI assistant that auto-replies to commands.
2. **WhatsApp Blackbox (Passive):** Silently archives all messages and media to the database.

### WhatsApp Blackbox (PostgreSQL Archive)
- **Purpose:** Captures ALL WhatsApp traffic passively without replying.
- **Database:** `whatsapp_blackbox` (PostgreSQL 16 + pgvector)
- **Container:** `whatsapp-postgres` (Image: `ankane/pgvector`)
- **Archiver Folder:** `/home/mike/whatsapp-blackbox/archiver` (Node.js/Baileys)
- **Media Archive:** `/home/mike/whatsapp-blackbox/media` (Isolated folder)
- **Direct DB Access:** `PGPASSWORD=mike7106 psql -h 127.0.0.1 -U mike -d whatsapp_blackbox`
- **Force Historical Sync:** To download extensive past history, stop the archiver service, clear the `auth` directory, and execute `node whatsapp_archiver_force.js` interactively on the VM. Scan the QR code and keep the WhatsApp app active on the primary device.

## Maintenance & Patching
**Local Patches Directory:** `./patches/` (on Windows host)

These scripts restore custom functionality after system updates (`git pull` or `npm update`).

### 1. Agent Zero Fixes
- **Script:** `patches/agent-zero/apply_patches.sh`
- **Fixes:** Bypasses RFC password requirement, fixes `FileBrowser` path mapping (`/a0/` -> real path), enables local uploads.
- **Apply:**
  ```bash
  scp -r patches/agent-zero/ mike@172.16.192.94:/home/mike/
  ssh mike@172.16.192.94 "bash ~/agent-zero/apply_patches.sh"
  ```

### 2. OpenClaw Blackbox & Mem0 Injection
- **Script (Blackbox):** `patches/openclaw/apply_blackbox_patch.sh`
- **Script (Mem0 Sync):** `patches/openclaw/apply_mem0_sync_patch.sh`
- **Fixes:**
    1. Re-injects passive WhatsApp logging.
    2. Modifies `session-memory.js` hook to distill conversations and sync facts to Mem0 on flush/exit.
- **Apply:**
  ```bash
  scp -r patches/openclaw/ mike@172.16.192.94:/home/mike/
  ssh mike@172.16.192.94 "bash ~/openclaw/apply_mem0_sync_patch.sh"
  ```

### 3. Mem0 Local Embeddings
- **Patch:** `patches/mem0/` — docker-compose.yml, config template, Pydantic schema docs
- **Fixes:** Replaces expired Google API key with local nomic-embed-text embeddings via LM Studio, routes LLM through Bridge.
- **Apply:**
  ```bash
  scp patches/mem0/docker-compose.yml mike@172.16.192.94:/home/mike/mem0/openmemory/
  ssh mike@172.16.192.94 "cd ~/mem0/openmemory && sg docker -c 'docker compose up -d'"
  # Then update config via API (see patches/mem0/config_router_patch.py for curl commands)
  ```

### 4. LM Studio Services (UbuntuLLM)
- **Patch:** `patches/lmstudio/` — 3 systemd unit files for headless boot
- **Apply:**
  ```bash
  scp patches/lmstudio/*.service mike@172.16.0.118:~/.config/systemd/user/
  ssh mike@172.16.0.118 "systemctl --user daemon-reload && systemctl --user enable xvfb lmstudio lmstudio-server"
  ```

### Firecrawl Reset
If scraping fails with `WrappedEngineError`:
```bash
ssh mike@172.16.192.94 "cd ~/firecrawl && docker compose restart && systemctl --user restart firecrawl-mcp"
```

## Service Management Commands & Boot Services

### VM1 (172.16.192.94) — Main VM
Linger Mode enabled for `mike`. All services auto-start on boot.

**User-Level Services (10):**
```bash
systemctl --user status agent-zero openclaw-gateway whatsapp-archiver firecrawl-mcp gemini-bridge
```
- `agent-zero.service` — Agent Zero Web UI
- `openclaw-gateway.service` — Active OpenClaw WhatsApp integration
- `whatsapp-archiver.service` — Passive WhatsApp Blackbox archiver
- `firecrawl-mcp.service` — Firecrawl MCP server for Kimi
- `gemini-bridge.service` — OAuth Bridge at ~/gemini-bridge-oauth

**System-Level Services (5):**
```bash
sudo systemctl status n8n mem0 firecrawl searxng caddy
```
- `n8n.service` — Automation platform
- `mem0.service` — Mem0 OpenMemory (Docker Compose: 3 containers, `restart: unless-stopped`)
- `firecrawl.service` — Web scraper (Docker Compose)
- `searxng.service` — Meta-search engine (Docker)
- `caddy.service` — Reverse proxy for SSL

### VM2 (172.16.0.118) — UbuntuLLM
Linger Mode enabled. LM Studio chain auto-starts on boot.

**User-Level Services (3):**
```bash
ssh mike@172.16.0.118 "systemctl --user status xvfb lmstudio lmstudio-server"
```
- `xvfb.service` — Virtual display :99 for headless LM Studio
- `lmstudio.service` — LM Studio AppImage (Requires xvfb)
- `lmstudio-server.service` — HTTP server on 0.0.0.0:1234 + auto-loads nomic-embed-text (Requires lmstudio)

### Common Commands
```bash
# Restart Agent Zero (after code changes)
systemctl --user restart agent-zero

# WhatsApp Blackbox Logs
journalctl --user -u whatsapp-archiver -f
docker logs whatsapp-postgres -f

# Check LM Studio models
ssh mike@172.16.0.118 "~/.lmstudio/bin/lms ps"
```

## Integrated CLI Agents
In addition to the service-based agents (Agent Zero and OpenClaw), the suite integrates four powerful CLI agents that tap into the shared Mem0 layer:
- **Kimi CLI (`kimi`):** Primary coding assistant with a built-in TUI (`kimi term`) and Web UI (`kimi web`). Uses Firecrawl and Mem0 via MCP.
- **Claude Code (`claude`):** Official Anthropic AI agent for terminal-based engineering.
- **OpenAI Codex (`codex`):** Terminal assistant translating natural language to shell commands.
- **Gemini CLI (`gemini`):** Interactive system management and development interface.

## Security & Privacy Safeguards
- **Context Isolation:** `dmScope: per-channel-peer` ensures each user has a private session.
- **Strict Send Policy:** Default `deny` policy; model responses only sent to authorized numbers (`+48509879642`).
- **Owner-Only Commands:** Native commands limited to Mike's phone number.
- **System Filtering:** Automated stripping of technical status logs from model history in Gemini Bridge.
- **Group Protection:** Silent in groups by default (`allowlist` policy).

## Development Conventions
- Use `.venv` for Python.
- Follow PEP 8.
- Maintain "maximum results, minimum effort" philosophy.
- **Owner-Only Agency:** WhatsApp commands that trigger actions are restricted to `+48509879642` (Mike).
