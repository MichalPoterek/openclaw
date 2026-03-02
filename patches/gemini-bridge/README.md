# Gemini Bridge — OAuth Proxy with Intelligent Compression

An OpenAI-compatible API proxy that translates requests to Google's Cloud Code Assist API using Gemini CLI OAuth credentials. Provides smart model routing, per-client cache isolation, context compression via LM Studio, and paired before/after snapshots in pgvector.

## Architecture

```
┌──────────────┐   ┌──────────────┐
│  Agent Zero   │   │   OpenClaw    │
│ (port 5000)   │   │ (port 18789)  │
│ provider:other│   │ provider:     │
│               │   │ gemini-bridge │
└──────┬───────┘   └──────┬───────┘
       │ OpenAI format     │ OpenAI format
       │ Bearer auth       │ X-API-Key auth
       └──────────┬────────┘
                  ▼
        ┌─────────────────┐
        │  Gemini Bridge   │
        │   (port 3458)    │
        │                  │
        │ • Client detect  │
        │ • Cache (LRU)    │
        │ • Compression    │
        │ • Model routing  │
        │ • Rate limiting  │
        └────┬────────┬────┘
             │        │
    ┌────────▼──┐  ┌──▼──────────┐
    │  Gemini    │  │  LM Studio   │
    │ Cloud Code │  │  Qwen 30B    │
    │ Assist API │  │ (fallback)   │
    └────────────┘  └──────────────┘
```

## How It Works

### OAuth Flow

The bridge shares OAuth credentials with the official [Gemini CLI](https://github.com/google/gemini-cli):

1. **Initial setup**: Run `gemini` CLI → browser opens Google OAuth consent → grants `cloud-platform` scope → tokens saved to `~/.gemini/oauth_creds.json`
2. **Bridge reads** the same credential file on every request
3. **Auto-refresh**: `google-auth-library` checks `expiry_date`, uses `refresh_token` to get fresh `access_token` when expired
4. **API calls**: Bridge sends requests to `cloudcode-pa.googleapis.com/v1internal:generateContent` with the access token
5. **User-Agent spoofing**: Must send `GeminiCLI/{version}/{model} (linux; x64)` — VS Code UA drops rate limit from ~20+ RPM to ~1 RPM

The OAuth `client_id` and `client_secret` come from the Gemini CLI source (Google's official installed-app credentials — not secret per OAuth spec).

### Model Routing

The bridge maintains two model chains and routes based on the requested model name:

| Model name pattern | Thinking | Chain |
|--------------------|----------|-------|
| Contains `pro` | ON | REASONING: `3.1-pro → 3-flash → 2.5-pro → 2.5-flash → lite` |
| Contains `flash` or `lite` | OFF | SUBAGENT: `3-flash → 2.5-flash → lite` |
| Contains `flash` + `thinking` | ON | SUBAGENT: `3-flash → 2.5-flash → lite` |
| Simple query (no tools, short) | OFF | LM Studio (Qwen 30B) |

On 429/5xx errors, the bridge walks down the chain trying each model. After exhausting the chain, it retries with server-suggested wait times, then falls back to LM Studio.

### Context Compression

When context exceeds 800K tokens, the bridge compresses using LM Studio with a 10/60/30 structure:

- **Project DNA (10%)** — what the project is about, decisions made, tech stack
- **Progressive History (60%)** — old messages heavily summarized, recent messages preserved
- **Action Context (30%)** — pending tasks, milestones, routing hints

Paired before/after snapshots are stored in pgvector for future optimization analysis.

### Per-Client Cache Isolation

Cache keys include a `clientId` derived from `X-Client-Id` header or `User-Agent`. Agent Zero and OpenClaw never share cache entries even for identical requests.

## Files

| File | Purpose |
|------|---------|
| `index.cjs` | Main bridge server (~1250 lines) |
| `docker-compose.yml` | Bridge + pgvector containers |
| `Dockerfile` | Node.js 22 container for the bridge |
| `init.sql` | pgvector schema (snapshots, quality feedback, operation log) |
| `.env.template` | Environment variables template |

## Setup From Scratch

### Prerequisites

- Node.js 22+
- Docker (for pgvector)
- [Gemini CLI](https://github.com/google/gemini-cli) installed and authenticated
- LM Studio with Qwen 30B (optional, for compression + fallback)

### Step 1: Get OAuth Credentials

```bash
# Install Gemini CLI
npm install -g @google/gemini-cli

# Authenticate (opens browser)
gemini

# Verify credentials exist
ls -la ~/.gemini/oauth_creds.json
```

The OAuth `client_id` and `client_secret` are in the Gemini CLI source:
```bash
grep -r "client_id" ~/.npm-global/lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js
```

### Step 2: Start pgvector Database

```bash
cd /path/to/gemini-bridge
cp .env.template .env
# Edit .env with your values (OAuth client ID/secret, bridge API key, PG password)

# Start pgvector container only
docker compose up -d bridge-db

# Verify
docker compose ps
PGPASSWORD=your-password psql -h 127.0.0.1 -p 5433 -U bridge -d bridge_context -c "\dt"
```

### Step 3: Install and Run Bridge

```bash
# Install dependencies
npm install express axios cors google-auth-library pg

# Run directly
node index.cjs

# Or via systemd (create service file)
cat > ~/.config/systemd/user/gemini-bridge.service << 'EOF'
[Unit]
Description=Gemini OAuth Bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/mike/gemini-bridge-oauth
Environment=GOOGLE_CLIENT_ID=your-client-id
Environment=GOOGLE_CLIENT_SECRET=your-client-secret
Environment=BRIDGE_API_KEY=your-bridge-api-key
Environment=LMSTUDIO_API_KEY=your-lmstudio-key
Environment=PG_HOST=127.0.0.1
Environment=PG_PORT=5433
Environment=PG_USER=bridge
Environment=PG_PASSWORD=your-pg-password
Environment=PG_DATABASE=bridge_context
ExecStart=/usr/bin/node index.cjs
Restart=always
RestartSec=10
StandardOutput=append:/home/mike/gemini-bridge-oauth/bridge.log
StandardError=append:/home/mike/gemini-bridge-oauth/bridge.log

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now gemini-bridge
```

### Step 4: Verify

```bash
# Health check
curl http://localhost:3458/health | jq .

# Test request
curl -X POST http://localhost:3458/v1/chat/completions \
  -H "X-API-Key: your-bridge-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"hello"}]}'
```

## Configuring Agent Zero

Agent Zero connects to the bridge as an OpenAI-compatible endpoint. **No code changes required** — configuration only.

### Settings (`usr/settings.json`)

```json
{
  "chat_model_provider": "other",
  "chat_model_name": "gemini-3.1-pro-preview",
  "chat_model_api_base": "http://127.0.0.1:3458/v1",
  "chat_model_kwargs": { "temperature": "0" },
  "chat_model_ctx_length": 1000000,
  "chat_model_ctx_history": 0.85,
  "chat_model_vision": true,

  "util_model_provider": "other",
  "util_model_name": "gemini-2.5-flash-lite",
  "util_model_api_base": "http://127.0.0.1:3458/v1",
  "util_model_kwargs": { "temperature": "0" },
  "util_model_ctx_length": 1000000,
  "util_model_ctx_input": 0.85,

  "browser_model_provider": "other",
  "browser_model_name": "gemini-3-flash-preview",
  "browser_model_api_base": "http://127.0.0.1:3458/v1",
  "browser_model_kwargs": { "temperature": "0" },
  "browser_model_vision": true,

  "embed_model_provider": "huggingface",
  "embed_model_name": "sentence-transformers/all-MiniLM-L6-v2",

  "api_keys": {
    "other": "your-bridge-api-key"
  }
}
```

### Environment (`usr/.env`)

```bash
API_KEY_OTHER=your-bridge-api-key
```

> **Important**: Agent Zero reads API keys from `.env` via `API_KEY_{PROVIDER}` format. Setting it only in `settings.json` `api_keys` dict is not enough — the `.env` file is the authoritative source for keys at runtime.

### How It Routes Through Bridge

| A0 Model Slot | Bridge Model | Bridge Classification | Thinking |
|---------------|-------------|----------------------|----------|
| Chat | `gemini-3.1-pro-preview` | thinking-main | ON |
| Utility | `gemini-2.5-flash-lite` | fast-sub | OFF |
| Browser | `gemini-3-flash-preview` | fast-sub | OFF |
| Embedding | local HuggingFace | N/A (no bridge) | N/A |

### Compression Alignment

Agent Zero compresses history at 850K tokens (topic-based, using utility model). Bridge compresses at 800K tokens. Since A0 compresses first and reduces to ~680K (below bridge's 800K threshold), **double compression never occurs**. Bridge compression acts as a safety net only.

```
Context grows → 850K → A0 compresses to ~680K → below 800K → Bridge skips
                                                               └→ Safety net only
```

### Sub-Agents

Agent Zero sub-agents (subordinates) inherit the **same model configuration** as the parent agent. There is no per-subordinate model override — they differ only by prompt profile (e.g., `developer`, `researcher`). This is an Agent Zero design decision, not a bridge limitation.

## Configuring OpenClaw

OpenClaw uses the bridge as its AI provider via the `gemini-bridge` provider in `openclaw.json`.

### Provider Config (`openclaw.json`)

```json
{
  "models": {
    "providers": {
      "gemini-bridge": {
        "baseUrl": "http://YOUR_VM_IP:3458/v1",
        "apiKey": "your-bridge-api-key",
        "auth": "api-key",
        "api": "openai-completions",
        "models": [
          { "id": "gemini-3.1-pro-preview", "name": "Gemini 3.1 Pro (Reasoning)", "contextWindow": 1000000, "maxTokens": 8192, "input": ["text", "image"] },
          { "id": "gemini-3-flash-preview", "name": "Gemini 3 Flash (Sub-agent)", "contextWindow": 1000000, "maxTokens": 8192, "input": ["text", "image"] },
          { "id": "gemini-3-flash-thinking", "name": "Gemini 3 Flash Thinking", "contextWindow": 1000000, "maxTokens": 8192, "input": ["text", "image"] },
          { "id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro (Fallback)", "contextWindow": 1000000, "maxTokens": 8192, "input": ["text", "image"] },
          { "id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash (Fallback)", "contextWindow": 1000000, "maxTokens": 8192, "input": ["text", "image"] },
          { "id": "gemini-2.5-flash-lite", "name": "Gemini 2.5 Flash Lite", "contextWindow": 1000000, "maxTokens": 8192, "input": ["text", "image"] }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "gemini-bridge/gemini-3.1-pro-preview",
        "fallbacks": ["gemini-bridge/gemini-2.5-pro", "gemini-bridge/gemini-2.5-flash"]
      },
      "models": {
        "gemini-bridge/gemini-3-flash-preview": { "alias": "flash" },
        "gemini-bridge/gemini-2.5-flash-lite": { "alias": "lite" },
        "gemini-bridge/gemini-3-flash-thinking": { "alias": "think" }
      },
      "contextTokens": 950000,
      "compaction": {
        "mode": "safeguard",
        "reserveTokensFloor": 50000,
        "maxHistoryShare": 0.85,
        "memoryFlush": { "enabled": true, "softThresholdTokens": 800000 }
      },
      "subagents": {
        "maxConcurrent": 8,
        "model": {
          "primary": "gemini-bridge/gemini-3-flash-preview",
          "fallbacks": ["gemini-bridge/gemini-2.5-flash"]
        },
        "thinking": "off"
      }
    }
  }
}
```

### Sub-Agent Models

OpenClaw supports per-sub-agent model overrides via `sessions_spawn`:

| Mode | Model | Thinking | Use case |
|------|-------|----------|----------|
| Default | `gemini-3-flash-preview` | OFF | Most sub-tasks |
| Think | `gemini-3-flash-thinking` | ON | Complex reasoning |
| Lite | `gemini-2.5-flash-lite` | OFF | Trivial formatting |

The LLM learns about these options from `TOOLS.md` (loaded into system prompt per session).

### Compression for OpenClaw

OpenClaw has no built-in intelligent compression — only a "safeguard" mode at 950K tokens. The bridge handles compression at 800K → 400K, which is the primary compression layer for OpenClaw.

```
Context grows → 800K → Bridge compresses to 400K → OpenClaw continues
               → 950K → OpenClaw safeguard (last resort, should not trigger)
```

## Health Endpoint

```bash
curl http://localhost:3458/health | jq .
```

Returns:
- `subsystems` — status of Gemini OAuth, LM Studio, pgvector, compression cache
- `compression` — threshold, target, cache size, hit/miss stats
- `pgvector` — snapshot count, DB size
- `tiers` — all routing tiers with model chains
- `cache` — LRU cache size, hit rate, per-source breakdown
- `rateLimit` — current request rate

## pgvector — Paired Context Snapshots

Every compression event stores a **paired snapshot** in PostgreSQL: the full original context and the compressed output side by side. This creates a growing dataset for analysis and optimization.

### What Gets Stored

**`context_snapshots`** — one row per compression event:

| Column | Content |
|--------|---------|
| `original_context` | Full conversation history as JSONB (before compression) |
| `original_token_estimate` | Token count of original context |
| `original_message_count` | Number of messages in original |
| `compressed_context` | Compressed 10/60/30 output as JSONB (after compression) |
| `compressed_token_estimate` | Token count after compression |
| `compression_ratio` | Ratio (e.g., 0.5 = compressed to 50% of original) |
| `compression_latency_ms` | How long LM Studio took to compress |
| `model_used` | Which model performed the compression |
| `embedding` | vector(768) for semantic search (future use) |

**`compression_quality`** — feedback per snapshot:

| Column | Content |
|--------|---------|
| `model_response_success` | Did the model respond correctly after receiving compressed context? |
| `model_response_tokens` | Response token count |
| `had_tool_calls` | Whether the response included tool calls |
| `error_occurred` | Whether an error happened |
| `response_latency_ms` | Response latency |

**`operation_log`** — timing for all bridge operations (auto-cleaned after 7 days).

### Auto-Cleanup

- Max **200 snapshots per session** (oldest deleted via trigger)
- Operation log kept for **7 days** only

### Querying Snapshots

```bash
# Recent compression events
PGPASSWORD=your-password psql -h 127.0.0.1 -p 5433 -U bridge -d bridge_context \
  -c "SELECT id, session_id, original_token_estimate, compressed_token_estimate,
      compression_ratio, compression_latency_ms
      FROM context_snapshots ORDER BY id DESC LIMIT 10;"

# Average compression quality
PGPASSWORD=your-password psql -h 127.0.0.1 -p 5433 -U bridge -d bridge_context \
  -c "SELECT avg(compression_ratio)::numeric(4,2) as avg_ratio,
      avg(compression_latency_ms)::int as avg_latency_ms,
      count(*) as total FROM context_snapshots;"

# Compare original vs compressed for a specific snapshot
PGPASSWORD=your-password psql -h 127.0.0.1 -p 5433 -U bridge -d bridge_context \
  -c "SELECT original_message_count, original_token_estimate,
      compressed_token_estimate, compression_ratio
      FROM context_snapshots WHERE id = 1;"
```

### Future: MCP Tools for Direct Model Access

Planned: an MCP server that exposes pgvector snapshots as tools, allowing AI agents (Agent Zero, OpenClaw, Gemini CLI) to directly query compression history from within their conversations:

- **`search_compression_history`** — semantic search across past compressed contexts (via pgvector embeddings)
- **`get_snapshot`** — retrieve a specific paired snapshot (original + compressed) by ID or session
- **`compression_stats`** — aggregated statistics (avg ratio, latency trends, quality scores)
- **`recall_project_context`** — retrieve the most recent Project DNA / Action Context blocks for a session, enabling agents to "remember" past sessions even after restart

This will close the loop: agents can learn from their own compression history and recover context that was previously compressed away.

## Troubleshooting

### OAuth token expired / 401 from Gemini
```bash
# Re-authenticate via Gemini CLI
gemini
# This refreshes ~/.gemini/oauth_creds.json
# Bridge picks up new tokens automatically (re-reads file each request)
```

### Bridge returns LM Studio responses for everything
Check if Gemini models are hitting 429 (rate limit). The bridge falls back to LM Studio when all Gemini models are exhausted.
```bash
tail -f /home/mike/gemini-bridge-oauth/bridge.log
# Look for: [Gemini] model 429: No capacity available
```

### Agent Zero "api_key must be set" error
Ensure `API_KEY_OTHER=your-bridge-key` is in `usr/.env` (not just in `settings.json`).

### pgvector connection failed
```bash
docker compose ps  # bridge-db should be healthy
docker compose logs bridge-db | tail -10
PGPASSWORD=your-password psql -h 127.0.0.1 -p 5433 -U bridge -d bridge_context -c "SELECT 1"
```

### Check compression stats
```bash
PGPASSWORD=your-password psql -h 127.0.0.1 -p 5433 -U bridge -d bridge_context \
  -c "SELECT id, session_id, original_token_estimate, compressed_token_estimate, compression_ratio, compression_latency_ms FROM context_snapshots ORDER BY id DESC LIMIT 5;"
```
