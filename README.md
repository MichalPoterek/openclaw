# VM AI Agent Suite Platform

A highly available, multi-agent orchestration platform running on dedicated infrastructure.

## Architecture & Infrastructure

### VM 1 — Main (172.16.192.94)
- **OS:** Pop!_OS 24.04 (Linux)
- **Access:** SSH `mike@172.16.192.94` (Pass: `mike7106`)
- **Linger Mode:** Enabled (User services start on boot without active session)

### Core Components

#### 1. AI Frameworks
- **Agent Zero:** Primary autonomous agent. Fixed for direct local file management (bypassing RFC).
- **OpenClaw (Active Gateway):** Multi-channel active gateway. Serves as your AI assistant capable of auto-replying to WhatsApp messages. If logged out, run `/home/mike/.npm-global/bin/openclaw channels login` to scan a new QR code.
- **Kimi K2.5:** Integrated via Web UI and CLI.

#### 2. WhatsApp Blackbox (The Passive Archive)
A dedicated, passive logging system that silently captures all incoming/outgoing WhatsApp data in the background, completely separate from OpenClaw's active session.
- **Database:** PostgreSQL with `pgvector` for future ML training.
- **Storage:** `/home/mike/whatsapp-blackbox/media` (Isolated media archive).
- **Integration:** OpenClaw has a dedicated skill (`whatsapp_blackbox`) to query this archive.
- **Forcing History Sync:** To retroactively download years of past history, stop the service, clear the `/home/mike/whatsapp-blackbox/archiver/auth` folder, run `node whatsapp_archiver_force.js` interactively on the VM to get a QR code, scan it, and leave the app open on your primary phone.

#### 3. Shared Resources (MCP)
- **Mem0:** Shared memory layer for cross-agent intelligence.
- **Firecrawl:** Self-hosted web scraper (Playwright-based).
- **SearXNG:** Meta-search engine for real-time web access.

## Access & Security

### Unified Credentials
- **User:** `mike`
- **Password:** `mike7106`
- **Authorized Admin Number:** `+48509879642`

### Security Hardening
- **Network:** All raw backend ports (DBs, APIs) bound to `127.0.0.1`.
- **Proxy:** External access via **Caddy** with SSL and Basic Auth.
- **Firewall:** `ufw-docker` enforced.

## Key Operational Paths
- **Agent Zero UI:** `https://172.16.192.94:5001`
- **WhatsApp Blackbox Root:** `/home/mike/whatsapp-blackbox`
- **OpenClaw Workspace:** `/home/mike/.openclaw/workspace`
- **Skill Definitions:** `.../workspace/skills/`

## Troubleshooting

### If Agent Zero "Files" tab fails:
The system is patched to avoid RFC password errors. If it reoccurs, ensure `python/api/get_work_dir_files.py` uses direct `FileBrowser` calls and restart the service.

### If Firecrawl Search fails:
Restart the entire stack: `cd ~/firecrawl && docker compose restart && systemctl --user restart firecrawl-mcp`.

## Maintenance & Recovery
The system relies on custom modifications that may be overwritten during software updates. Use the local patch scripts to restore functionality.

- **Location:** `./patches/` (Local Windows Directory)
- **Agent Zero Patch:** Restores file browser access and RFC bypass.
- **OpenClaw Patch:** Restores Blackbox logging and **Mem0 Auto-Sync**.

### Active Agents Roster
The system integrates 6 active AI agents:
- **Service-Based Agents:**
  - **Agent Zero:** Primary autonomous agent. Accessible via Web UI at `https://172.16.192.94:5001`.
  - **OpenClaw:** Active gateway for WhatsApp interactions.
- **CLI Agents:**
  - **Kimi CLI (`kimi`):** Primary coding assistant with TUI (`kimi term`) and Web UI (`kimi web`).
  - **Claude Code (`claude`):** Terminal-based engineering assistant (@anthropic-ai/claude-code).
  - **OpenAI Codex (`codex`):** Terminal assistant for shell commands (@openai/codex).
  - **Gemini CLI (`gemini`):** System management and development interface.

### Boot Services (Linger Mode)
Due to Linger Mode, the following 9 services start automatically after a VM reboot without requiring a user login:
- **User Services (mike):** 
  - `agent-zero.service`
  - `openclaw-gateway.service`
  - `whatsapp-archiver.service`
  - `firecrawl-mcp.service`
- **System Services (root):** 
  - `n8n.service`
  - `mem0.service`
  - `firecrawl.service`
  - `searxng.service`
  - `caddy.service`
- **Docker:** `whatsapp-postgres` database.

## Project History & Evolution
- **Feb 2026:** Implementation of WhatsApp Blackbox.
- **Feb 2026:** Repair of Agent Zero file handling and RFC bypass.
- **Feb 2026:** Unified 9 agents under a shared Mem0 memory layer.
