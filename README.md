# VM AI Agent Suite Platform

A comprehensive AI agent orchestration platform that coordinates multiple AI agents to help with programming, automation, daily life optimization, and wealth generation - all with maximum efficiency and minimum effort.

## Vision

This platform brings together multiple AI agent tools running across dedicated VMs to create a unified suite that assists across three key areas:

### Programming & Automation
- Automated code generation, debugging, and refactoring
- CI/CD pipeline management and DevOps automation
- Multi-agent collaboration on complex development tasks

### Daily Life Optimization
- Health tracking and wellness routine suggestions
- Family life coordination and scheduling
- Habit building and personal productivity

### Wealth & Income Generation
- Identifying high-efficiency income strategies
- Financial task automation
- Passive income workflow creation
- Productivity maximization with minimal effort

## AI Agent Stack

The platform orchestrates tools across multiple VMs:

### VM 1 — Main (172.16.192.94, Pop!_OS 24.04)
| Service | Description | Port | URL |
|---------|-------------|------|-----|
| **Agent Zero** | Autonomous general-purpose AI agent framework | :5000 | https://172.16.192.94:5001 (password protected) |
| **n8n** | Workflow automation platform for connecting services and automating tasks | :5678 | https://172.16.192.94:5680 (password protected) |
| **Goose** | AI coding agent by Block for automated dev workflows | :3000 | https://172.16.192.94:3001 (password protected) |
| **OpenCode** | AI-powered coding assistant (headless API + web UI) | :3002 | https://172.16.192.94:3003 (password protected) |
| **OpenClaw** | AI agent gateway, dashboard, and messaging (WhatsApp, etc.) | :18789 | https://172.16.192.94:18790/?token=\<gateway-token\> (self-signed cert) |
| **Mem0** | Shared memory layer — persistent context across all agents (API + MCP) | :8765 | https://172.16.192.94:8766 (password protected) |
| **Mem0 Dashboard** | Browse and manage shared agent memories (also proxies API) | :3004 | https://172.16.192.94:3005 (password protected) |

### AI CLI Tools (VM 1)
| CLI | Description | Auth |
|-----|-------------|------|
| **Claude Code** | Anthropic's AI coding agent | Claude Pro account |
| **Gemini CLI** | Google's AI coding agent | Google account |
| **Codex CLI** | OpenAI's AI coding agent | OpenAI account |

### VM 2 — Kimi (IP TBD)
| Service | Description | Port |
|---------|-------------|------|
| **Kimi K2.5** | Large language model for reasoning and code tasks | TBD |

## Getting Started

### Prerequisites
- Python 3.x
- Access to the VM (Linux) with AI agents installed
- SSH client

### Setup

1. Clone the repository
2. Create and activate a virtual environment:
   ```bash
   python -m venv .venv
   source .venv/Scripts/activate  # Windows (Git Bash)
   # or
   .venv\Scripts\activate         # Windows (CMD)
   # or
   source .venv/bin/activate      # macOS/Linux
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Configure VM connection (see `.env.example` for required variables)

### Running

```bash
python main.py
```

## Project Structure

```
VM_ai_agent_suit_platform/
├── main.py          # Application entry point
├── .venv/           # Python virtual environment
├── CLAUDE.md        # Claude Code configuration
└── README.md        # This file
```

## Architecture

```
┌──────────────────────────────────────────────┐
│           Windows Host (PyCharm)             │
│        VM AI Agent Suite Platform            │
│            (Orchestrator / main.py)          │
└──────────┬───────────────────────┬───────────┘
           │ SSH / API             │ SSH / API
           ▼                       ▼
┌──────────────────────────┐  ┌──────────────────┐
│  VM 1 — Main             │  │  VM 2 — Kimi     │
│  172.16.192.94           │  │  IP TBD          │
│                          │  │                  │
│  ┌────────────────────┐  │  │  ┌────────────┐  │
│  │ Agent Zero  :5001  │  │  │  │  Kimi K2.5 │  │
│  └────────────────────┘  │  │  └────────────┘  │
│  ┌────────────────────┐  │  │                  │
│  │ n8n          :5680 │  │  └──────────────────┘
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │ Goose        :3001 │  │
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │ OpenCode     :3003 │  │
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │ OpenClaw    :18790 │  │
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │ Mem0 API     :8766 │  │
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │ Mem0 UI      :3005 │  │
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │ Caddy (HTTPS+auth) │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

## License

TBD