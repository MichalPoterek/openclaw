pl# CLAUDE.md

## Project Overview
VM AI Agent Suite Platform - A comprehensive AI agent orchestration platform that coordinates multiple AI agents to assist with:
- **Programming & Automation:** Code generation, debugging, refactoring, CI/CD, DevOps tasks
- **Daily Life Optimization:** Health tracking, habit building, family scheduling, wellness routines
- **Wealth & Income:** Identifying efficient income strategies, financial automation, passive income workflows, productivity optimization

The core philosophy is **maximum results with minimum effort** - leveraging AI agents to automate repetitive work and surface the highest-impact actions.

## Tech Stack
- **Language:** Python
- **IDE:** PyCharm (Windows host)
- **Virtual Environment:** `.venv/` (standard venv)
- **VM Environment:** Linux VM running AI agent tools

## AI Agents

### VM 1 — Main (172.16.192.94, Pop!_OS 24.04)
| Service | Purpose | Port | URL | Management |
|---------|---------|------|-----|------------|
| **Agent Zero** | Autonomous AI agent framework | :5000 | `https://172.16.192.94:5001` (basic auth: mike) | systemd user: `agent-zero.service` |
| **n8n** | Workflow automation platform | :5678 | `https://172.16.192.94:5680` (basic auth: mike) | systemd system: `n8n.service` |
| **Goose** | AI coding agent by Block | :3000 | `https://172.16.192.94:3001` (basic auth: mike) | systemd user: `goose.service` |
| **OpenCode** | AI coding assistant (headless API + web) | :3002 | `https://172.16.192.94:3003` (basic auth: mike) | systemd user: `opencode-serve.service` |
| **OpenClaw** | AI agent gateway + dashboard + WhatsApp | :18789 | `https://172.16.192.94:18790/?token=<gateway-token>` | systemd user: `openclaw-gateway.service` |
| **Mem0** | Shared memory layer (API + MCP) | :8765 | `https://172.16.192.94:8766` (basic auth: mike) | systemd system: `mem0.service` (Docker Compose) |
| **Mem0 Dashboard** | Memory browser/manager UI | :3004 | `https://172.16.192.94:3005` (basic auth: mike) | part of `mem0.service` |
| **Qdrant** | Vector database for Mem0 | :6333 (internal) | not exposed externally | part of `mem0.service` |
| **Caddy** | HTTPS reverse proxy with basic auth | :5001/:5680/:3001/:3003/:18790/:8766/:3005 | proxies to all backend services | systemd system: `caddy.service` |

### AI CLI Tools (VM 1)
| CLI | Version | Auth | Command |
|-----|---------|------|---------|
| **Claude Code** | 2.1.42 | Claude Pro account (claude.ai) | `claude` |
| **Gemini CLI** | 0.28.2 | Google account | `gemini` |
| **Codex CLI** | 0.101.0 | OpenAI account | `codex` |

### VM 2 — Kimi (IP TBD)
| Service | Purpose | Port |
|---------|---------|------|
| **Kimi K2.5** | Large language model for reasoning and code tasks | TBD |

## Service Management (VM 1)
```bash
# Agent Zero (user service)
systemctl --user status agent-zero
systemctl --user restart agent-zero

# n8n (system service)
sudo systemctl status n8n
sudo systemctl restart n8n

# Goose (user service)
systemctl --user status goose
systemctl --user restart goose

# OpenCode (user service)
systemctl --user status opencode-serve
systemctl --user restart opencode-serve

# OpenClaw (user service)
systemctl --user status openclaw-gateway
systemctl --user restart openclaw-gateway
openclaw gateway status                     # detailed status
openclaw dashboard                          # open dashboard

# Mem0 OpenMemory (system service, Docker Compose)
sudo systemctl status mem0
sudo systemctl restart mem0
# Mem0 Docker logs:
docker compose -f /home/mike/mem0/openmemory/docker-compose.yml logs -f

# Caddy HTTPS proxy (system service) — proxies :5001→:5000, :5680→:5678, :3001→:3000, :3003→:3002, :18790→:18789, :8766→:8765, :3005→:3004
sudo systemctl status caddy
sudo systemctl restart caddy
```

## Mem0 Configuration
- **LLM Provider:** Google Gemini (`gemini-2.0-flash`)
- **Embedder:** Google (`models/gemini-embedding-001`, 768 dims)
- **Vector Store:** Qdrant (internal, port 6333)
- **Data:** `/home/mike/mem0/openmemory/` (repo + config), Docker volumes for Qdrant storage
- **Config API:** `https://172.16.192.94:8766/api/v1/config/` — change LLM/embedder providers at runtime
- **API Docs:** `https://172.16.192.94:8766/docs`

### Mem0 Agent Integrations
| Agent | Method | Status |
|-------|--------|--------|
| **Goose** | MCP SSE extension (`openmemory` in config.yaml) | Connected |
| **OpenCode** | MCP remote server (`opencode.json` in /home/mike) | Wired |
| **OpenClaw** | REST API via TOOLS.md instructions | Wired |
| **Agent Zero** | Custom tools: `mem0_save`, `mem0_search` (+ prompt) | Wired |
| **n8n** | HTTP Request nodes — template at `/home/mike/mem0-n8n-workflow.json` | Template ready |
| **Claude Code** | MCP SSE (`claude mcp add-json`) | Connected |
| **Gemini CLI** | MCP SSE (`~/.gemini/settings.json`) | Connected |
| **Codex CLI** | MCP HTTP (`codex mcp add`) | Connected |

MCP SSE URL pattern: `http://localhost:8765/mcp/{client_name}/sse/mike`
REST API: `http://localhost:8765/api/v1/memories/`

## VM Connections
Credentials are stored in `.env` (never committed to git). See `.env.example` for the template.
- **VM1 SSH:** `ssh $VM_USER@$VM_HOST`
- **VM2 SSH:** `ssh $VM2_USER@$VM2_HOST` (to be configured)
- Load with: `source .env` or use `python-dotenv` in code

## Project Structure
```
VM_ai_agent_suit_platform/
├── main.py          # Application entry point
├── .env             # VM credentials (git-ignored)
├── .env.example     # Template for .env
├── .gitignore       # Git ignore rules
├── .venv/           # Python virtual environment (do not modify)
├── CLAUDE.md        # Claude Code instructions (this file)
└── README.md        # Project documentation
```

## Development Conventions
- Use the `.venv` virtual environment for all Python operations
- Activate venv before running: `source .venv/Scripts/activate` (Windows/Git Bash)
- Entry point: `main.py`
- When interacting with the VM, use SSH or API calls to `172.16.192.94`

## Commands
- **Run:** `python main.py`
- **Install dependencies:** `pip install <package>` (with venv activated)
- **SSH to VM:** `ssh mike@172.16.192.94`

## Guidelines for Claude
- Always read existing code before modifying it
- Keep code simple and well-structured
- Follow PEP 8 style conventions
- Do not modify files inside `.venv/`
- When designing features, prioritize simplicity and automation
- Consider all three pillars: programming productivity, daily life quality, and wealth generation
- Favor solutions that require minimal ongoing maintenance