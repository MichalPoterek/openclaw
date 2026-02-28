# CLAUDE.md

## Project Overview
VM AI Agent Suite Platform - A comprehensive AI agent orchestration platform coordinating multiple agents for programming, automation, life optimization, and wealth generation.

## Repository & Configuration Tracking
- **Local Repo:** `C:\Users\Mike\PycharmProjects\VM_ai_agent_suit_platform` (Tracked via Git)
- **OpenClaw VM Config:** `/home/mike/.openclaw` (Tracked via Git on VM)
- **Current Model:** Gemini 2.0 Flash (Configured Feb 28, 2026)

## Tech Stack & Environment
- **Host VM 1 (Main):** 172.16.192.94 (Pop!_OS 24.04)
- **Host VM 2 (Kimi):** IP TBD
- **User:** `mike` | **Password:** `mike7106` (Unified for SSH, Web UI, and DB)
- **Language:** Python 3.12, Node.js 22
- **Infrastructure:** Docker Compose, Systemd (User & System services)

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
| **Mem0** | Shared Memory | SSE | :8765 | `https://172.16.192.94:8766` | **Auto-Sync:** OpenClaw automatically syncs session distillations. |
| **Firecrawl** | Web Scraper | HTTP Stream | :3008 | `https://172.16.192.94:3007` | **Node.js** version restored for Kimi. Agent Zero uses `firecrawl_native.py`. |
| **SearXNG** | Web Search | HTTP Stream | :8081 | `https://172.16.192.94:55511` | Rate limits unlocked. |
| **Gemini Bridge**| OAuth Bridge | HTTP (OpenAI) | :3458 | `http://172.16.192.94:3458`| **Auth:** `x-api-key: gemini-oauth-bridge-key-12345` |

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

### Firecrawl Reset
If scraping fails with `WrappedEngineError`:
```bash
ssh mike@172.16.192.94 "cd ~/firecrawl && docker compose restart && systemctl --user restart firecrawl-mcp"
```

## Service Management Commands & Boot Services
Due to Linger Mode being enabled for the `mike` user, the following 9 systemd services automatically start upon VM reboot:

### 1. User-Level Services (Run as `mike`)
```bash
# Check status of user services that start on boot
systemctl --user status agent-zero openclaw-gateway whatsapp-archiver firecrawl-mcp gemini-bridge
```
- `agent-zero.service` (Agent Zero Web UI)
- `openclaw-gateway.service` (Active OpenClaw WhatsApp integration)
- `whatsapp-archiver.service` (Passive WhatsApp Blackbox archiver)
- `firecrawl-mcp.service` (Custom Node.js Firecrawl MCP server for Kimi)
- `gemini-bridge.service` (OAuth 2.0 to OpenAI API translator at ~/gemini-bridge-oauth)

### 2. System-Level Services (Run as `root`)
```bash
# Check status of system services that start on boot
sudo systemctl status n8n mem0 firecrawl searxng caddy
```
- `n8n.service` (n8n automation platform)
- `mem0.service` (Shared cross-agent memory layer)
- `firecrawl.service` (Self-hosted web scraper)
- `searxng.service` (Meta-search engine)
- `caddy.service` (Reverse proxy for SSL and external access)

```bash
# Restart Agent Zero (after code changes)
systemctl --user restart agent-zero

# WhatsApp Blackbox Logs
journalctl --user -u whatsapp-archiver -f
docker logs whatsapp-postgres -f
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
