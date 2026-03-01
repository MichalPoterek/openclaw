# TOOLS.md - Local Infrastructure

## MCP Tools (via mcporter)
The `mcporter` CLI provides access to all MCP servers. Use the **exec** tool to call mcporter.

### Available Servers & Tools
| Server | Tool | Description |
|--------|------|-------------|
| searxng | `searxng_web_search` | Web search (free, unlimited, no API key) |
| searxng | `web_url_read` | Read/fetch a URL |
| firecrawl | `firecrawl_scrape` | Scrape a webpage |
| firecrawl | `firecrawl_search` | Search the web via Firecrawl |
| mem0 | `search_memory` | Search shared memory |
| mem0 | `add_memories` | Save a memory |
| mem0 | `list_memories` | List all memories |

### Usage
```
mcporter call searxng.searxng_web_search query="latest news Poland"
mcporter call searxng.web_url_read url="https://example.com"
mcporter call firecrawl.firecrawl_scrape url="https://example.com"
mcporter call mem0.search_memory query="Mike preferences"
mcporter call mem0.add_memories text="important fact to remember"
```

**ALWAYS search mem0** before answering questions about Mike, his preferences, family, or past context.
**ALWAYS save to mem0** after learning new facts worth remembering.

## SSH Hosts (Passwordless Access)
All hosts have passwordless SSH configured. Use exec tool to run commands.

### Main VM (this machine)
- **Host:** localhost (172.16.192.94)
- **OS:** Pop!_OS 24.04, 64GB RAM
- **User:** mike
- **Services:** Agent Zero, OpenClaw, WhatsApp Blackbox, n8n, Mem0, Firecrawl, SearXNG, Gemini Bridge
- **Run commands directly** via exec tool (no SSH needed)

### LM Studio Machine (UbuntuLLM)
- **Host:** 172.16.0.118
- **OS:** Ubuntu 25.04, GPU server (Vulkan)
- **User:** mike
- **Access:** ssh mike@172.16.0.118 "<command>"
- **LM Studio:** Port 1234
- **Loaded models:** Qwen 30B, DeepSeek R1 70B, Bielik 11B, GLM-4.7-Flash

## Databases

### WhatsApp Blackbox (PostgreSQL)
- **Connect:** PGPASSWORD=mike7106 psql -h 127.0.0.1 -U mike -d whatsapp_blackbox
- **Tables:** messages, contacts, media_files
- **Use for:** Searching chat history, finding contacts, retrieving past conversations

## Quick Reference
| Machine | IP | SSH | Purpose |
|---------|-----|-----|---------|
| Main VM | 172.16.192.94 | direct (localhost) | All services |
| UbuntuLLM | 172.16.0.118 | ssh mike@172.16.0.118 | LM Studio, GPU inference |
