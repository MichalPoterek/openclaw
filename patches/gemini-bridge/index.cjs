const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { Pool } = require("pg");

const app = express();
app.use(express.json({ limit: "100mb" }));
app.use(cors());

// ============================================================
// CONFIGURATION
// ============================================================
const PORT = process.env.PORT || 3458;
const CREDS_PATH = process.env.CREDS_PATH || "/home/mike/.gemini/oauth_creds.json";
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || "change-me";
const BASE_ENDPOINT = process.env.CODE_ASSIST_BASE || "https://cloudcode-pa.googleapis.com";
const CODE_ASSIST_ENDPOINT = `${BASE_ENDPOINT}/v1internal`;

// LM Studio (Qwen 30B)
const LMSTUDIO_ENDPOINT = process.env.LMSTUDIO_ENDPOINT || "http://172.16.0.118:1234/v1/chat/completions";
const LMSTUDIO_MODELS_ENDPOINT = process.env.LMSTUDIO_MODELS_ENDPOINT || "http://172.16.0.118:1234/v1/models";
const LMSTUDIO_API_KEY = process.env.LMSTUDIO_API_KEY || "";
const LMSTUDIO_TIMEOUT = 120000;
const LMSTUDIO_COMPRESS_TIMEOUT = 60000;

// Intelligent context compression
const COMPRESS_THRESHOLD = 800000;  // ~800K tokens — start compressing
const COMPRESS_TARGET    = 400000;  // compress DOWN to ~400K tokens
const COMPRESS_CACHE_MAX = 50;      // max cached compression sessions
const COMPRESS_CACHE_TTL = 30 * 60 * 1000; // 30 min
const COMPRESS_TIMEOUT   = 60000;   // 60s max for LM Studio compression call
const COMPRESS_ESTIMATED_SPEED = 1000; // ~1K tokens/sec for LM Studio

// pgvector (paired context snapshots)
const PG_HOST = process.env.PG_HOST || "bridge-db";
const PG_PORT = parseInt(process.env.PG_PORT || "5432");
const PG_USER = process.env.PG_USER || "bridge";
const PG_PASSWORD = process.env.PG_PASSWORD || "bridge7106";
const PG_DATABASE = process.env.PG_DATABASE || "bridge_context";

// Cache settings
const CACHE_MAX_SIZE = 500;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_KEY_MESSAGES = 3;

// Rate limiter (sliding window) — high limits since retry+fallback handles actual 429s
const RATE_WINDOW_MS = 60 * 1000;
const RATE_SOFT_LIMIT = 25;
const RATE_HARD_LIMIT = 40;

// Router
const SIMPLE_MSG_MAX_LENGTH = 200;
const LMSTUDIO_MAX_MESSAGES = 30; // Trim context for LM Studio (Qwen chokes on 2000+ messages)
const CODE_KEYWORDS = [
  "function", "class ", "def ", "import ", "require(", "const ", "let ", "var ",
  "error", "debug", "stack", "trace", "exception", "```",
  "async ", "await ", "return ", "if (", "for (", "while (",
  "SELECT ", "INSERT ", "UPDATE ", "DELETE ", "CREATE TABLE",
  "sudo ", "chmod ", "npm ", "pip ", "git ", "docker ",
];

// Gemini CLI identity (must match real CLI for proper rate limit tier)
const GEMINI_CLI_VERSION = "0.31.0";
function getGeminiHeaders(token, model) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": `GeminiCLI/${GEMINI_CLI_VERSION}/${model} (linux; x64)`,
  };
}

// Model chains ordered by capability (strongest → weakest)
// Each model has its OWN quota pool, so fallback cycles through fresh limits
const REASONING_CHAIN = [
  "gemini-3.1-pro-preview",   // strongest reasoning
  "gemini-3-flash-preview",   // strong, fast reasoning (3.x gen > 2.5 gen)
  "gemini-2.5-pro",           // solid reasoning, older gen
  "gemini-2.5-flash",         // adequate fallback
  "gemini-2.5-flash-lite",    // last resort
];

const SUBAGENT_CHAIN = [
  "gemini-3-flash-preview",   // best sub-agent model (fast + smart)
  "gemini-2.5-flash",         // fast fallback
  "gemini-2.5-flash-lite",    // lightest fallback
];

// Unified chain for health endpoint display
const MODEL_CHAIN = REASONING_CHAIN;

// Thinking config per model generation
const DEFAULT_THINKING_BUDGET = 8192;
function getThinkingConfig(model, thinking) {
  if (!thinking) {
    return { thinkingBudget: 0 };
  }
  if (model.startsWith("gemini-3")) {
    return { thinkingLevel: "HIGH" };
  }
  if (model.startsWith("gemini-2.5")) {
    return { thinkingBudget: DEFAULT_THINKING_BUDGET };
  }
  return { includeThoughts: true };
}

// Three routing modes — separate chains, different thinking:
//   1. "pro" models           → REASONING_CHAIN, thinking ON  (main agents — strongest first)
//   2. "flash/lite" models    → SUBAGENT_CHAIN,  thinking OFF (fast sub-agents — no pro quota waste)
//   3. "flash/lite" + "think" → SUBAGENT_CHAIN,  thinking ON  (sub-agents needing reasoning)
function getModelChain(requestedModel) {
  const m = requestedModel.toLowerCase();

  // Flash/lite with thinking (explicit: name contains "think" suffix)
  if ((m.includes("flash") || m.includes("lite")) && m.includes("think")) {
    return { chain: SUBAGENT_CHAIN, type: "thinking-sub", thinking: true };
  }
  // Pro models → always thinking, full reasoning chain (main agents)
  if (m.includes("pro")) {
    return { chain: REASONING_CHAIN, type: "thinking-main", thinking: true };
  }
  // Flash/lite → no thinking, sub-agent chain (fast sub-agents)
  if (m.includes("flash") || m.includes("lite")) {
    return { chain: SUBAGENT_CHAIN, type: "fast-sub", thinking: false };
  }
  // Default: thinking on, full reasoning chain
  return { chain: REASONING_CHAIN, type: "thinking-main", thinking: true };
}

// Retry settings
const RETRY_MAX_ATTEMPTS = 3; // per model on primary, 1 on fallbacks
const RETRY_JITTER = 0.3;

const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET);
let cachedProjectId = "maximal-droplet-7md0t";

// ============================================================
// LRU RESPONSE CACHE
// ============================================================
class LRUCache {
  constructor(maxSize, ttlMs) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  _hash(model, messages, clientId = "default") {
    const tail = messages.slice(-CACHE_KEY_MESSAGES);
    const content = tail.map(m => {
      const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${m.role}:${c}`;
    }).join("|");
    return crypto.createHash("sha256").update(`${clientId}||${model}||${content}`).digest("hex");
  }

  get(model, messages, clientId) {
    const key = this._hash(model, messages, clientId);
    const entry = this.map.get(key);
    if (!entry) { this.misses++; return null; }
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.map.delete(key);
      this.misses++;
      return null;
    }
    // LRU bump
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    console.log(`[Cache HIT] key=${key.substring(0, 12)}... client=${clientId} source=${entry.source} age=${Math.round((Date.now() - entry.timestamp) / 1000)}s`);
    return entry.response;
  }

  set(model, messages, response, source, clientId) {
    const key = this._hash(model, messages, clientId);
    if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, { response, timestamp: Date.now(), source });
  }

  stats() {
    let geminiCount = 0, lmstudioCount = 0;
    for (const v of this.map.values()) {
      if (v.source === "gemini") geminiCount++;
      else lmstudioCount++;
    }
    return {
      size: this.map.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + "%" : "N/A",
      entries: { gemini: geminiCount, lmstudio: lmstudioCount },
    };
  }
}

const cache = new LRUCache(CACHE_MAX_SIZE, CACHE_TTL_MS);

// ============================================================
// RATE LIMITER (Sliding Window)
// ============================================================
const geminiCallTimestamps = [];
let rateLimitedUntil = 0;

function recordGeminiCall() {
  geminiCallTimestamps.push(Date.now());
}

function getRateStatus() {
  const now = Date.now();
  while (geminiCallTimestamps.length > 0 && now - geminiCallTimestamps[0] > RATE_WINDOW_MS) {
    geminiCallTimestamps.shift();
  }
  const count = geminiCallTimestamps.length;
  const cooldownActive = now < rateLimitedUntil;

  if (cooldownActive) return { level: "blocked", count, cooldownRemaining: Math.ceil((rateLimitedUntil - now) / 1000) };
  if (count >= RATE_HARD_LIMIT) return { level: "hard", count };
  if (count >= RATE_SOFT_LIMIT) return { level: "soft", count };
  return { level: "ok", count };
}

function setRateLimitCooldown(seconds) {
  rateLimitedUntil = Date.now() + (seconds * 1000);
  console.log(`[RateLimit] Cooldown set for ${seconds}s`);
}

// ============================================================
// REQUEST CLASSIFIER (Smart Router)
// ============================================================
function classifyRequest(messages, tools) {
  if (tools && tools.length > 0) return "complex";

  const lastUser = [...messages].reverse().find(m => m.role === "user");
  if (!lastUser) return "standard";

  const content = typeof lastUser.content === "string"
    ? lastUser.content
    : Array.isArray(lastUser.content)
      ? lastUser.content.map(c => typeof c === "string" ? c : (c.text || "")).join(" ")
      : "";

  if (content.length > 500) return "complex";

  const lower = content.toLowerCase();
  for (const kw of CODE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return "complex";
  }
  if (/https?:\/\//.test(content)) return "complex";
  if (/\/[\w.-]+\/[\w.-]+/.test(content)) return "complex";
  if (/\{[\s\S]*\}/.test(content) && content.length > 50) return "complex";

  if (content.length <= SIMPLE_MSG_MAX_LENGTH) return "simple";
  return "standard";
}

// ============================================================
// LM STUDIO - Full Completion
// ============================================================
let lmstudioAvailable = null;
let lmstudioLastCheck = 0;
const LMSTUDIO_CHECK_INTERVAL = 30000;

async function checkLMStudioHealth() {
  const now = Date.now();
  if (lmstudioAvailable !== null && now - lmstudioLastCheck < LMSTUDIO_CHECK_INTERVAL) {
    return lmstudioAvailable;
  }
  try {
    await axios.get(LMSTUDIO_MODELS_ENDPOINT, {
      headers: { "Authorization": `Bearer ${LMSTUDIO_API_KEY}` },
      timeout: 5000,
    });
    lmstudioAvailable = true;
  } catch {
    lmstudioAvailable = false;
  }
  lmstudioLastCheck = now;
  return lmstudioAvailable;
}

async function callLMStudio(messages, systemPrompt, openAiTools = null, stream = false) {
  const fullMessages = [];
  if (systemPrompt) {
    fullMessages.push({ role: "system", content: systemPrompt });
  }

  // Clean messages for LM Studio — Qwen's Jinja template crashes on tool messages
  // Convert tool results to user messages, skip null-content assistant messages
  const cleaned = [];
  for (const msg of messages) {
    if (msg.role === "tool") {
      cleaned.push({ role: "user", content: `[Tool result from ${msg.name || "tool"}]: ${typeof msg.content === "string" ? msg.content.substring(0, 3000) : "done"}` });
    } else if (msg.role === "assistant" && msg.content === null && msg.tool_calls) {
      const calls = msg.tool_calls.map(tc => `${tc.function.name}(${tc.function.arguments})`).join(", ");
      cleaned.push({ role: "assistant", content: `[Called tools: ${calls}]` });
    } else if (msg.content !== null && msg.content !== undefined) {
      cleaned.push({ role: msg.role === "tool" ? "user" : msg.role, content: msg.content });
    }
  }

  // Trim to last N messages — Qwen chokes on 2000+ messages
  if (cleaned.length > LMSTUDIO_MAX_MESSAGES) {
    const trimmed = cleaned.length - LMSTUDIO_MAX_MESSAGES;
    console.log(`[LMStudio] Trimming context: ${cleaned.length} -> ${LMSTUDIO_MAX_MESSAGES} messages (dropped ${trimmed} oldest)`);
    const recent = cleaned.slice(-LMSTUDIO_MAX_MESSAGES);
    fullMessages.push({ role: "user", content: `[Context note: ${trimmed} earlier messages were trimmed. Focus on the recent conversation below.]` });
    fullMessages.push(...recent);
  } else {
    fullMessages.push(...cleaned);
  }

  const payload = {
    messages: fullMessages,
    temperature: 0.7,
    max_tokens: 8192,
    stream: false,
  };

  if (openAiTools && openAiTools.length > 0) {
    payload.tools = openAiTools;
    payload.tool_choice = "auto";
  }

  console.log(`[LMStudio] Calling with ${fullMessages.length} messages (from ${messages.length} original), tools=${!!(openAiTools && openAiTools.length)}`);

  const response = await axios.post(LMSTUDIO_ENDPOINT, payload, {
    headers: {
      "Authorization": `Bearer ${LMSTUDIO_API_KEY}`,
      "Content-Type": "application/json",
    },
    timeout: LMSTUDIO_TIMEOUT,
  });

  const msg = response.data.choices?.[0]?.message;
  const hasToolCalls = msg?.tool_calls && msg.tool_calls.length > 0;
  console.log(`[LMStudio] Response received (${msg?.content?.length || 0} chars, tool_calls=${hasToolCalls})`);
  return response.data;
}

// ============================================================
// RESILIENCE UTILITIES
// ============================================================
function timedOp(name) {
  const start = Date.now();
  return {
    done: (extra = "") => {
      const ms = Date.now() - start;
      const tag = ms > 5000 ? "SLOW" : ms > 1000 ? "warn" : "ok";
      console.log(`[Timer] ${name}: ${ms}ms [${tag}] ${extra}`);
      return ms;
    }
  };
}

async function withRetry(fn, { name = "operation", maxAttempts = 3, baseDelayMs = 1000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxAttempts;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4);
      console.warn(`[Retry] ${name} attempt ${attempt}/${maxAttempts} failed: ${err.message}${isLast ? " — giving up" : ` — retrying in ${Math.round(delay)}ms`}`);
      if (isLast) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

function logError(subsystem, operation, err, context = {}) {
  console.error(`[${subsystem}] ${operation} FAILED:`, {
    error: err.message,
    code: err.code,
    ...context,
    timestamp: new Date().toISOString(),
  });
}

// ============================================================
// PGVECTOR (Paired Context Snapshots)
// ============================================================
let pgAvailable = false;
const pool = new Pool({
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.warn("[pgvector] Pool error:", err.message);
  pgAvailable = false;
});

async function initDB() {
  try {
    await withRetry(async () => {
      const client = await pool.connect();
      client.release();
      pgAvailable = true;
      console.log("[pgvector] Connected to bridge_context DB");
    }, { name: "DB connect", maxAttempts: 5, baseDelayMs: 3000 });
  } catch (err) {
    logError("pgvector", "initDB", err);
    pgAvailable = false;
    // Schedule periodic reconnect attempts
    setInterval(async () => {
      if (pgAvailable) return;
      try {
        const client = await pool.connect();
        client.release();
        pgAvailable = true;
        console.log("[pgvector] Reconnected to DB");
      } catch { /* still offline */ }
    }, 60000);
  }
}

async function checkDiskSpace() {
  if (!pgAvailable) return { dbSizeMB: -1 };
  try {
    const result = await pool.query("SELECT pg_database_size(current_database()) as db_size");
    const dbSizeMB = Math.round(result.rows[0].db_size / 1048576);
    if (dbSizeMB > 5000) {
      console.warn(`[Disk] DB size ${dbSizeMB}MB — consider cleanup`);
    }
    return { dbSizeMB };
  } catch { return { dbSizeMB: -1 }; }
}

async function getSnapshotCount() {
  if (!pgAvailable) return -1;
  const result = await pool.query("SELECT count(*) as cnt FROM context_snapshots");
  return parseInt(result.rows[0].cnt);
}

async function saveCompressionSnapshot(sessionId, original, compressed, stats) {
  if (!pgAvailable) return null;
  try {
    const result = await withRetry(async () => {
      return pool.query(
        `INSERT INTO context_snapshots
         (session_id, original_message_count, original_token_estimate, original_context,
          compressed_token_estimate, compressed_context, compression_ratio,
          compression_latency_ms, model_used, trigger_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [sessionId, original.messageCount, original.tokenEstimate,
         JSON.stringify(original.messages.slice(0, 50)), // store first 50 msgs to limit JSONB size
         stats.compressedTokens, JSON.stringify(compressed),
         stats.compressedTokens / original.tokenEstimate,
         stats.latencyMs, stats.model, stats.reason]
      );
    }, { name: "snapshot write", maxAttempts: 2, baseDelayMs: 1000 });
    return result.rows[0].id;
  } catch (err) {
    logError("pgvector", "saveCompressionSnapshot", err, { sessionId });
    return null;
  }
}

async function logCompressionQuality(snapshotId, success, responseTokens, hadToolCalls, error) {
  if (!pgAvailable || !snapshotId) return;
  pool.query(
    `INSERT INTO compression_quality
     (snapshot_id, model_response_success, model_response_tokens, had_tool_calls, error_occurred)
     VALUES ($1, $2, $3, $4, $5)`,
    [snapshotId, success, responseTokens || 0, hadToolCalls || false, !!error]
  ).catch(() => {}); // fire-and-forget
}

async function logOperation(operation, durationMs, success, inputSize, outputSize, error) {
  if (!pgAvailable) return;
  pool.query(
    `INSERT INTO operation_log (operation, duration_ms, success, input_size, output_size, error_message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [operation, durationMs, success, inputSize, outputSize, error || null]
  ).catch(() => {}); // fire-and-forget
}

// ============================================================
// INTELLIGENT CONTEXT COMPRESSION (10/60/30 Structure)
// ============================================================
const compressionCache = new Map();
const compressionStats = { count: 0, totalRatio: 0, totalLatencyMs: 0, cacheHits: 0, cacheMisses: 0 };

const COMPRESS_SYSTEM_PROMPT = `You are a Context Compression AI for an AI agent orchestration system.
Your job is to compress conversation history into a structured format that maximizes
the effectiveness of AI agents that will read this context.

OUTPUT FORMAT (use these exact headers):

## PROJECT DNA
[What this project/session is about. What's accomplished. Current goals.
Include: workflow/plan (how we proceed, next phases, step order, dependencies),
business decisions made (and WHY), programming patterns used,
technologies and tools in the stack. 3-5 paragraphs.]

## HISTORY
[Progressive summary: older events get 1 sentence each, recent events get full detail.
ALWAYS preserve: tool results, errors+fixes, file paths, config values, decisions made.
Older = shorter. Newer = more detailed.]

## ACTION CONTEXT
[What needs doing next. Which tools to use. Agent routing hints (thinking vs fast).
Patterns: what approaches worked/failed. Key blockers or dependencies.
IMPORTANT: List completed milestones with git commit hashes where available
(format: "✓ Milestone description — commit abc1234").
Number pending tasks in priority order.]

RULES:
- Do NOT answer questions. ONLY compress.
- Preserve ALL file paths, URLs, config values, error messages, commit hashes verbatim.
- Preserve business decisions with their reasoning (the "why").
- Preserve technology choices and programming patterns used.
- For tool calls: keep tool name + key result, drop verbose output.
- Recent messages (last 20%) should be barely compressed — keep full details.
- Old messages (first 30%) can be aggressively summarized.
- Git commit hashes: extract any mentioned commit hashes and associate them with
  the milestone/task they completed. List them in ACTION CONTEXT.
- Total output MUST be shorter than input by at least 60%.`;

function estimateTokens(messages) {
  return Math.round(JSON.stringify(messages).length / 4);
}

function getSessionFingerprint(messages, systemPrompt) {
  const firstUser = messages.find(m => m.role === "user");
  const key = (firstUser?.content || "").substring(0, 200) + "||" + (systemPrompt || "").substring(0, 200);
  return crypto.createHash("sha256").update(key).digest("hex").substring(0, 16);
}

function cleanCompressionCache() {
  const now = Date.now();
  for (const [key, entry] of compressionCache) {
    if (now - entry.timestamp > COMPRESS_CACHE_TTL) {
      compressionCache.delete(key);
    }
  }
  // Enforce max size
  while (compressionCache.size > COMPRESS_CACHE_MAX) {
    const oldest = compressionCache.keys().next().value;
    compressionCache.delete(oldest);
  }
}

async function compressContext(messages, systemPrompt) {
  const tokens = estimateTokens(messages);
  if (tokens < COMPRESS_THRESHOLD) {
    return { messages, sessionId: null, compressed: false };
  }

  const sessionId = getSessionFingerprint(messages, systemPrompt);

  // Check compression cache — if same session with few new messages, reuse + append
  const cached = compressionCache.get(sessionId);
  if (cached && messages.length - cached.fullMessageCount <= 10) {
    compressionStats.cacheHits++;
    const newMessages = messages.slice(cached.fullMessageCount);
    const combined = [...cached.compressedMessages, ...newMessages];
    const combinedTokens = estimateTokens(combined);
    if (combinedTokens < COMPRESS_THRESHOLD) {
      console.log(`[Compress] Cache HIT: reusing compressed context + ${newMessages.length} new msgs (${combinedTokens} tokens)`);
      return { messages: combined, sessionId, compressed: true, fromCache: true };
    }
    // Cache stale — too many new messages accumulated, re-compress
  }
  compressionStats.cacheMisses++;

  // Check LM Studio health
  if (!(await checkLMStudioHealth())) {
    console.warn("[Compress] LM Studio offline — skipping compression");
    return { messages, sessionId, compressed: false };
  }

  const estimatedDuration = Math.round(tokens / COMPRESS_ESTIMATED_SPEED);
  console.log(`[Compress] Starting compression: ${tokens} tokens, ${messages.length} msgs, est. ${estimatedDuration}s`);
  const timer = timedOp("LMStudio compress");

  try {
    // Build the history text for compression
    let historyText = "";
    for (const msg of messages) {
      const content = typeof msg.content === "string" ? msg.content
        : Array.isArray(msg.content) ? msg.content.map(c => typeof c === "string" ? c : (c.text || "")).join(" ")
        : JSON.stringify(msg.content);
      historyText += `[${msg.role}]: ${content}\n\n`;
    }

    // Truncate to fit LM Studio context — send up to ~120K chars (~30K tokens)
    const maxHistoryChars = 120000;
    let truncatedHistory = historyText;
    if (historyText.length > maxHistoryChars) {
      // Keep first 20% and last 60% to preserve recent context
      const headSize = Math.round(maxHistoryChars * 0.2);
      const tailSize = Math.round(maxHistoryChars * 0.6);
      truncatedHistory = historyText.substring(0, headSize)
        + `\n\n... [${historyText.length - headSize - tailSize} chars omitted] ...\n\n`
        + historyText.substring(historyText.length - tailSize);
    }

    const compressionPrompt = `Compress the following conversation (${messages.length} messages, ~${tokens} tokens) into the structured format. Target output: ~${Math.round(COMPRESS_TARGET * 4)} characters.\n\n` + truncatedHistory;

    const response = await withRetry(async () => {
      return axios.post(LMSTUDIO_ENDPOINT, {
        messages: [
          { role: "system", content: COMPRESS_SYSTEM_PROMPT },
          { role: "user", content: compressionPrompt },
        ],
        temperature: 0.1,
        max_tokens: 8192,
        stream: false,
      }, {
        headers: { "Authorization": `Bearer ${LMSTUDIO_API_KEY}`, "Content-Type": "application/json" },
        timeout: COMPRESS_TIMEOUT,
      });
    }, { name: "LMStudio compress", maxAttempts: 2, baseDelayMs: 2000 });

    const latencyMs = timer.done(`${tokens}→${estimateTokens([{ content: response.data.choices[0].message.content }])} tokens`);

    const compressedText = response.data.choices[0].message.content;
    if (!compressedText || compressedText.length < 100) {
      console.warn("[Compress] LM Studio returned empty/tiny response — using original");
      return { messages, sessionId, compressed: false };
    }

    // Determine how many recent messages to keep uncompressed (last 20%, up to 30)
    const recentCount = Math.min(30, Math.max(5, Math.round(messages.length * 0.2)));
    const recentMessages = messages.slice(-recentCount);

    // Reconstruct compressed message array
    const compressedMessages = [
      { role: "user", content: `[Compressed Context — ${messages.length - recentCount} earlier messages]\n\n${compressedText}` },
      { role: "assistant", content: "Understood. I have the compressed context with project DNA, history, and action items. Continuing with the recent messages below." },
      ...recentMessages,
    ];

    const compressedTokens = estimateTokens(compressedMessages);
    const ratio = compressedTokens / tokens;

    // Update stats
    compressionStats.count++;
    compressionStats.totalRatio += ratio;
    compressionStats.totalLatencyMs += latencyMs;

    console.log(`[Compress] Done: ${tokens} → ${compressedTokens} tokens (${(ratio * 100).toFixed(1)}% of original, ${latencyMs}ms)`);

    // Cache the result
    compressionCache.set(sessionId, {
      compressedMessages,
      fullMessageCount: messages.length,
      timestamp: Date.now(),
    });
    cleanCompressionCache();

    // Save paired snapshot to pgvector (async — don't block response)
    saveCompressionSnapshot(sessionId, {
      messageCount: messages.length,
      tokenEstimate: tokens,
      messages,
    }, compressedMessages, {
      compressedTokens,
      latencyMs,
      model: "lmstudio-qwen-30b",
      reason: `tokens ${tokens} > threshold ${COMPRESS_THRESHOLD}`,
    }).then(id => {
      if (id) logOperation("compress", latencyMs, true, tokens, compressedTokens, null);
    }).catch(() => {});

    return { messages: compressedMessages, sessionId, compressed: true, snapshotId: null };
  } catch (err) {
    const latencyMs = timer.done("FAILED");
    logError("Compress", "LM Studio call", err, { tokenCount: tokens });
    logOperation("compress", latencyMs, false, tokens, 0, err.message).catch(() => {});
    // Graceful degradation — return original messages
    return { messages, sessionId, compressed: false };
  }
}

// ============================================================
// GEMINI API (OAuth Cloud Code Assist)
// ============================================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getAccessToken() {
  try {
    if (!fs.existsSync(CREDS_PATH)) return null;
    const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8"));
    oauth2Client.setCredentials(creds);
    const { token } = await oauth2Client.getAccessToken();
    return token;
  } catch (err) { return null; }
}

async function discoverProject(token) {
  try {
    const response = await axios.post(`${CODE_ASSIST_ENDPOINT}:loadCodeAssist`, {
      metadata: { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" }
    }, {
      headers: getGeminiHeaders(token, "gemini-2.5-flash")
    });
    const projectId = response.data.cloudaicompanionProject?.id || response.data.cloudaicompanionProject;
    if (projectId && typeof projectId === "string") { cachedProjectId = projectId; return projectId; }
  } catch (err) {}
  return cachedProjectId;
}

// Try a single Gemini API call for a specific model
async function tryGeminiOnce(token, projectId, contents, model, tools, systemInstruction, thinking = true) {
  const thinkingConfig = getThinkingConfig(model, thinking);
  const payload = {
    model: model.replace("models/", ""),
    project: projectId,
    user_prompt_id: "prompt-" + Date.now(),
    request: {
      contents,
      session_id: "session-" + crypto.randomUUID(),
      generationConfig: {
        temperature: 1, topP: 0.95, topK: 64,
        thinkingConfig,
      },
    }
  };

  // Proper systemInstruction field (not injected as user message)
  if (systemInstruction) {
    payload.request.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  if (tools && tools.length > 0) {
    payload.request.tools = tools;
  }

  try {
    recordGeminiCall();
    const estTokens = Math.round(JSON.stringify(payload).length / 4);
    console.log(`[Gemini] ${model} [Project: ${projectId}] [Est tokens: ${estTokens}]`);

    const response = await axios.post(`${CODE_ASSIST_ENDPOINT}:generateContent`, payload, {
      headers: getGeminiHeaders(token, model),
      timeout: 180000,
    });

    return { success: true, data: response.data, model };

  } catch (err) {
    if (err.response?.status === 429) {
      const errMsg = err.response.data?.error?.message || "";
      const isDaily = errMsg.toLowerCase().includes("daily") || errMsg.includes("QUOTA_EXHAUSTED");
      let waitSec = 0;
      const match = errMsg.match(/after (\d+)s/);
      if (match) waitSec = parseInt(match[1]);

      console.log(`[Gemini] ${model} 429: ${errMsg.substring(0, 120)} (wait=${waitSec}s, daily=${isDaily})`);
      return { success: false, retryable: !isDaily, waitSec, model };
    }

    if (err.response?.status >= 500) {
      console.log(`[Gemini] ${model} server error ${err.response.status}`);
      return { success: false, retryable: true, waitSec: 5, model };
    }

    throw err;
  }
}

// Call Gemini with retry + model fallback chain
async function callGeminiWithRetry(contents, requestedModel, tools, systemInstruction) {
  const token = await getAccessToken();
  if (!token) throw new Error("OAuth credentials not configured");
  const projectId = await discoverProject(token);

  // Skip context optimization — OpenClaw manages its own compaction
  // optimizeContextWithLocalLLM adds 3-5s latency per request and is redundant
  const optimizedContents = contents;

  // Ensure contents are valid
  if (optimizedContents.length === 0) {
    optimizedContents.push({ role: "user", parts: [{ text: "hi" }] });
  }

  // Merge consecutive same-role turns
  const mergedContents = [];
  optimizedContents.forEach(c => {
    if (mergedContents.length > 0 && mergedContents[mergedContents.length - 1].role === c.role) {
      mergedContents[mergedContents.length - 1].parts.push(...c.parts);
    } else {
      mergedContents.push(c);
    }
  });

  // Build model chain based on requested model family
  // Strip virtual suffixes (e.g. "gemini-3-flash-thinking" → keep chain logic but use real model names)
  const { chain, type, thinking } = getModelChain(requestedModel);
  // Clean requested model name: remove "-thinking" suffix if present (virtual model)
  const cleanRequestedModel = requestedModel.replace(/-thinking$/i, "");
  // Requested model first (if in chain), then rest of chain
  // If cleaned model isn't in the chain (virtual name), just use chain order
  const modelChain = chain.includes(cleanRequestedModel)
    ? [cleanRequestedModel, ...chain.filter(m => m !== cleanRequestedModel)]
    : [...chain];
  let longestWait = 0;

  // Phase 1: Try each model once (fast — cycles through different quota pools)
  console.log(`[Gemini] Phase 1 (${type}, thinking=${thinking}): trying [${modelChain.join(" → ")}]`);
  for (const model of modelChain) {
    const result = await tryGeminiOnce(token, projectId, mergedContents, model, tools, systemInstruction, thinking);
    if (result.success) {
      if (model !== cleanRequestedModel) console.log(`[Gemini] Success on fallback: ${model}`);
      return result;
    }
    if (result.waitSec) longestWait = Math.max(longestWait, result.waitSec);
    if (!result.retryable) continue; // daily limit → skip this model
  }

  // Phase 2: Wait for cooldown, then retry all models
  if (longestWait > 0 && longestWait <= 60) {
    const waitMs = (longestWait + 2) * 1000;
    console.log(`[Gemini] Phase 2: waiting ${longestWait + 2}s then retrying`);
    await sleep(waitMs);

    for (const model of modelChain) {
      const result = await tryGeminiOnce(token, projectId, mergedContents, model, tools, systemInstruction, thinking);
      if (result.success) return result;
    }
  }

  console.log(`[Gemini] All ${type} models exhausted after retry`);
  setRateLimitCooldown(longestWait || 30);
  return null; // Signal caller to try LM Studio
}

// ============================================================
// FORMAT CONVERTERS
// ============================================================
function transformInputToContents(input) {
  if (typeof input === "string") return [{ role: "user", parts: [{ text: input }] }];
  if (!Array.isArray(input)) return [];

  const rawContents = input.map(item => {
    const role = (item.role === "assistant" || item.role === "model") ? "model" : (item.role === "tool" ? "tool" : "user");
    let text = "";
    if (typeof item.content === "string" && item.content) {
      text = item.content;
    } else if (Array.isArray(item.content)) {
      text = item.content.map(c => {
        if (typeof c === "string") return c;
        if (c.type === "text" || c.type === "output_text" || c.type === "input_text") return c.text;
        return "";
      }).join(" ");
    }

    if (text.startsWith("System: [") || text.includes("session store") || text.includes("Heartbeat interval")) {
      return null;
    }

    let parts = [];
    if (text) parts.push({ text });
    if (role === "model" && parts.length === 0 && !item.tool_calls) return null;

    // Convert tool interactions to text to avoid thought_signature requirement
    // (Cloud Code Assist API requires thought_signatures on functionCall parts in history,
    // but OpenClaw strips them during OpenAI format normalization)
    if (item.role === "tool" || item.role === "toolResult") {
      const toolName = item.name || item.toolName || "unknown";
      const resultText = typeof item.content === "string" ? item.content : JSON.stringify(item.content);
      const truncated = resultText.length > 2000 ? resultText.substring(0, 2000) + "... [truncated]" : resultText;
      return {
        role: "model",
        parts: [{ text: `I received this result from ${toolName}: ${truncated}` }]
      };
    }

    if (item.tool_calls) {
      item.tool_calls.forEach(tc => {
        const argsStr = typeof tc.function.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function.arguments);
        let argsSummary;
        try { argsSummary = Object.entries(JSON.parse(argsStr)).map(([k,v]) => `${k}="${v}"`).join(", "); }
        catch(e) { argsSummary = argsStr; }
        parts.push({ text: `I used the ${tc.function.name} tool with ${argsSummary}.` });
      });
    }

    return parts.length > 0 ? { role, parts } : null;
  }).filter(Boolean);

  const mergedContents = [];
  rawContents.forEach(content => {
    if (mergedContents.length > 0 && mergedContents[mergedContents.length - 1].role === content.role) {
      mergedContents[mergedContents.length - 1].parts.push(...content.parts);
    } else {
      mergedContents.push(content);
    }
  });
  return mergedContents;
}

function convertTools(openAiTools) {
  if (!openAiTools) return null;
  return [{ function_declarations: openAiTools.map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })) }];
}

function formatGeminiAsOpenAI(result, model) {
  const geminiData = result.response || {};
  const candidate = geminiData.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  let text = "";
  let thinkingText = "";
  const tool_calls = [];
  parts.forEach(p => {
    // Filter out thought parts (thinking mode) — keep them separate
    if (p.thought) {
      if (p.text) thinkingText += p.text;
      return;
    }
    if (p.text) text += p.text;
    if (p.functionCall) {
      tool_calls.push({
        id: "call_" + crypto.randomUUID().substring(0, 8),
        type: "function",
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args) }
      });
    }
  });
  if (thinkingText) {
    console.log(`[Thinking] ${thinkingText.length} chars of model reasoning filtered`);
  }

  return {
    id: result.traceId || ("ca-" + Date.now()),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text || null, tool_calls: tool_calls.length > 0 ? tool_calls : undefined },
      finish_reason: tool_calls.length > 0 ? "tool_calls" : "stop",
    }],
    usage: {
      prompt_tokens: geminiData.usageMetadata?.promptTokenCount || 0,
      completion_tokens: geminiData.usageMetadata?.candidatesTokenCount || 0,
      total_tokens: geminiData.usageMetadata?.totalTokenCount || 0,
    },
    _source: "gemini",
  };
}

function formatLMStudioAsOpenAI(lmResponse, model) {
  return { ...lmResponse, model, _source: "lmstudio" };
}

// ============================================================
// MIDDLEWARE
// ============================================================
app.use((req, res, next) => {
  console.log(`\n--- ${new Date().toISOString()} ${req.method} ${req.url} ---`);
  next();
});

// ============================================================
// ENDPOINTS
// ============================================================
app.get("/health", async (req, res) => {
  const lmOk = await checkLMStudioHealth();
  const avgRatio = compressionStats.count > 0 ? (compressionStats.totalRatio / compressionStats.count * 100).toFixed(1) + "%" : "N/A";
  const avgLatency = compressionStats.count > 0 ? Math.round(compressionStats.totalLatencyMs / compressionStats.count) : 0;
  res.json({
    status: "ok",
    uptime: Math.round(process.uptime()),
    cache: cache.stats(),
    rateLimit: getRateStatus(),
    lmstudio: { available: lmOk, endpoint: LMSTUDIO_ENDPOINT },
    geminiOAuth: { endpoint: CODE_ASSIST_ENDPOINT },
    modelChain: MODEL_CHAIN,
    thinkingBudget: DEFAULT_THINKING_BUDGET,
    compression: {
      threshold: COMPRESS_THRESHOLD,
      target: COMPRESS_TARGET,
      cacheSize: compressionCache.size,
      stats: {
        count: compressionStats.count,
        avgRatio,
        avgLatencyMs: avgLatency,
        cacheHits: compressionStats.cacheHits,
        cacheMisses: compressionStats.cacheMisses,
      },
    },
    pgvector: {
      available: pgAvailable,
      snapshotCount: await getSnapshotCount().catch(() => -1),
      dbSizeMB: (await checkDiskSpace()).dbSizeMB,
    },
    subsystems: {
      geminiOAuth: "ok",
      lmstudio: lmOk ? "ok" : "offline",
      pgvector: pgAvailable ? "ok" : "offline",
      compressionCache: compressionCache.size > 0 ? "warm" : "cold",
    },
    tiers: [
      "1: Main agent (thinking ON):  " + REASONING_CHAIN.join(" → "),
      "2: Sub-agent (thinking OFF):  " + SUBAGENT_CHAIN.join(" → "),
      "3: Sub-agent (thinking ON):   " + SUBAGENT_CHAIN.join(" → "),
      "4: LM Studio Qwen 30B (unlimited, with tools) [simple queries + fallback]",
    ],
  });
});

app.post("/v1/chat/completions", async (req, res) => {
  const providedKey = req.headers["x-api-key"]
    || (req.headers["authorization"] ? req.headers["authorization"].replace("Bearer ", "") : null)
    || req.query.key;
  if (providedKey !== BRIDGE_API_KEY) return res.status(401).json({ error: "Unauthorized" });

  // Identify client for cache isolation
  const clientId = req.headers["x-client-id"]
    || (req.headers["user-agent"] || "").split("/")[0]
    || "unknown";

  const model = req.body.model || "gemini-2.5-flash";
  const messages = req.body.messages || [];
  const isStream = req.body.stream === true;
  let systemInstruction = null;
  const filteredMessages = messages.filter(m => {
    if (m.role === "system") { systemInstruction = m.content; return false; }
    return true;
  });
  const openAiTools = req.body.tools;
  const tools = convertTools(openAiTools);
  const tier = classifyRequest(filteredMessages, openAiTools);
  const rate = getRateStatus();

  // Log tool names for diagnostics
  if (openAiTools && openAiTools.length > 0) {
    const toolNames = openAiTools.map(t => t.function?.name || t.name || "?").join(", ");
    console.log(`[Router] tier=${tier} rate=${rate.level}(${rate.count}/min) cache=${cache.map.size} tools=[${toolNames}]`);
  } else {
    console.log(`[Router] tier=${tier} rate=${rate.level}(${rate.count}/min) cache=${cache.map.size}`);
  }

  try {
    // ---- Step 0: Intelligent Context Compression ----
    const originalTokens = estimateTokens(filteredMessages);
    let workingMessages = filteredMessages;
    let compressionSessionId = null;
    let compressionSnapshotId = null;

    if (originalTokens > COMPRESS_THRESHOLD) {
      console.log(`[Compress] ${originalTokens} tokens > ${COMPRESS_THRESHOLD} threshold — compressing`);
      const compResult = await compressContext(filteredMessages, systemInstruction);
      workingMessages = compResult.messages;
      compressionSessionId = compResult.sessionId;
      if (compResult.compressed) {
        console.log(`[Compress] ${originalTokens} -> ${estimateTokens(workingMessages)} tokens`);
      }
    }

    // ---- Step 1: Check cache ----
    // Cache check works for ALL requests (including those with tools,
    // keyed on messages only — tools don't change the answer for same input)
    const cached = cache.get(model, workingMessages, clientId);
    if (cached) {
      const taggedResp = { ...cached, _source: "cache:" + (cached._source || "unknown") };
      return sendResponse(res, taggedResp, isStream, model);
    }

    // ---- Step 2: Smart routing (2-tier) ----
    // Tier 1: Gemini OAuth (Cloud Code Assist) — best quality, rate-limited
    // Tier 2: LM Studio (Qwen 30B local) — no limits, with tools support
    let response = null;
    const lmAvailable = await checkLMStudioHealth();
    const hasTools = openAiTools && openAiTools.length > 0;

    // SIMPLE + no tools -> LM Studio directly (save all Gemini quota)
    if (!response && tier === "simple" && !hasTools && lmAvailable) {
      console.log("[Router] SIMPLE -> LM Studio");
      try {
        const lmResp = await callLMStudio(workingMessages, systemInstruction, openAiTools);
        response = formatLMStudioAsOpenAI(lmResp, model);
      } catch (err) {
        console.warn("[Router] LM Studio failed for simple request.", err.message, err.response?.data ? JSON.stringify(err.response.data).substring(0, 300) : "");
      }
    }

    // STANDARD + no tools + soft/hard/blocked -> LM Studio
    if (!response && tier === "standard" && !hasTools && lmAvailable &&
        (rate.level === "soft" || rate.level === "hard" || rate.level === "blocked")) {
      console.log(`[Router] STANDARD + rate=${rate.level} + no tools -> LM Studio`);
      try {
        const lmResp = await callLMStudio(workingMessages, systemInstruction, openAiTools);
        response = formatLMStudioAsOpenAI(lmResp, model);
      } catch (err) {
        console.warn("[Router] LM Studio failed.", err.message, err.response?.data ? JSON.stringify(err.response.data).substring(0, 300) : "");
      }
    }

    // ---- Step 3: Gemini OAuth (primary) with retry + model fallback ----
    if (!response && rate.level === "ok") {
      console.log("[Router] -> Gemini OAuth");
      const contents = transformInputToContents(workingMessages);
      const geminiResult = await callGeminiWithRetry(contents, model, tools, systemInstruction);

      if (geminiResult === null) {
        // All models exhausted — fall through to LM Studio
        console.log("[Router] All Gemini models exhausted -> trying LM Studio");
      } else {
        response = formatGeminiAsOpenAI(geminiResult.data, geminiResult.model || model);
      }
    }

    // ---- Step 4: LM Studio (fallback for everything) ----
    if (!response && lmAvailable) {
      console.log("[Router] -> LM Studio (fallback)");
      try {
        const lmResp = await callLMStudio(workingMessages, systemInstruction, openAiTools);
        response = formatLMStudioAsOpenAI(lmResp, model);
      } catch (err) {
        console.warn("[Router] LM Studio failed.", err.message, err.response?.data ? JSON.stringify(err.response.data).substring(0, 300) : "");
      }
    }

    if (!response) {
      return res.status(429).json({ error: "All backends exhausted (OAuth rate-limited, LM Studio unavailable)" });
    }

    // ---- Cache the response ----
    // Don't cache tool_call responses — they have content:null and are part of
    // a multi-turn flow (tool execution). Caching them causes "null" replies
    // when the same question is asked again.
    if (response) {
      const msg = response.choices?.[0]?.message;
      const hasToolCalls = msg?.tool_calls && msg.tool_calls.length > 0;
      if (!hasToolCalls) {
        cache.set(model, workingMessages, response, response._source || "unknown", clientId);
      } else {
        console.log("[Cache] Skipping cache for tool_call response");
      }
    }

    // ---- Log compression quality (async) ----
    if (compressionSessionId) {
      const respMsg = response?.choices?.[0]?.message;
      const responseTokens = response?.usage?.total_tokens || 0;
      const hadToolCalls = !!(respMsg?.tool_calls && respMsg.tool_calls.length > 0);
      logCompressionQuality(compressionSnapshotId, !!response, responseTokens, hadToolCalls, null)
        .catch(e => console.warn("[Quality] Log failed:", e.message));
    }

    // ---- Step 5: Send ----
    return sendResponse(res, response, isStream, model);

  } catch (err) {
    console.error("[Error]", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.response?.data || err.message });
  }
});

// ============================================================
// RESPONSE SENDER
// ============================================================
function sendResponse(res, response, isStream, model) {
  const source = response._source || "unknown";
  const cleanResp = { ...response };
  delete cleanResp._source;

  if (isStream) {
    res.setHeader("Content-Type", "text/event-stream");
    const text = cleanResp.choices?.[0]?.message?.content;
    const toolCalls = cleanResp.choices?.[0]?.message?.tool_calls;
    const created = cleanResp.created || Math.floor(Date.now() / 1000);

    if (text) {
      res.write("data: " + JSON.stringify({
        object: "chat.completion.chunk", created, model,
        choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }]
      }) + "\n\n");
    }
    if (toolCalls && toolCalls.length > 0) {
      res.write("data: " + JSON.stringify({
        object: "chat.completion.chunk", created, model,
        choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: "tool_calls" }]
      }) + "\n\n");
    }
    res.write("data: " + JSON.stringify({
      id: cleanResp.id, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: cleanResp.usage || {},
    }) + "\n\n");
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    res.json(cleanResp);
  }
  console.log(`[Response] source=${source} stream=${isStream}`);
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================
async function gracefulShutdown(signal) {
  console.log(`[Shutdown] ${signal} received, closing connections...`);
  try {
    await Promise.race([
      pool.end(),
      new Promise(r => setTimeout(r, 5000))
    ]);
    console.log("[Shutdown] DB pool closed");
  } catch (err) {
    console.warn("[Shutdown] DB pool close error:", err.message);
  }
  console.log("[Shutdown] Clean exit");
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ============================================================
// START
// ============================================================
app.listen(PORT, async () => {
  console.log("");
  console.log("=== Gemini Bridge (OAuth + LM Studio + Compression) ===");
  console.log("Port: " + PORT);
  console.log("Tier 1: OAuth Cloud Code Assist — " + CODE_ASSIST_ENDPOINT);
  console.log("  Reasoning: " + REASONING_CHAIN.join(" → "));
  console.log("  SubAgent:  " + SUBAGENT_CHAIN.join(" → "));
  console.log("  Main agent: thinking ON (REASONING) | Sub-agent: thinking OFF (SUBAGENT) | Sub-thinking: thinking ON (SUBAGENT)");
  console.log("  Thinking: " + DEFAULT_THINKING_BUDGET + " tokens (2.5), HIGH level (3.x)");
  console.log("  Retry: Phase 1 (try all) + Phase 2 (wait+retry)");
  console.log("  User-Agent: GeminiCLI/" + GEMINI_CLI_VERSION);
  console.log("Tier 2: LM Studio (Qwen 30B) — " + LMSTUDIO_ENDPOINT);
  console.log("Compression: threshold=" + COMPRESS_THRESHOLD + " target=" + COMPRESS_TARGET);
  console.log("Cache: " + CACHE_MAX_SIZE + " entries, " + (CACHE_TTL_MS / 1000) + "s TTL");
  console.log("No API keys — OAuth only.");
  console.log("=========================================================");
  console.log("");

  // Initialize subsystems
  const lmOk = await checkLMStudioHealth();
  console.log("[Startup] LM Studio: " + (lmOk ? "ONLINE" : "OFFLINE"));

  await initDB();
  console.log("[Startup] pgvector: " + (pgAvailable ? "ONLINE" : "OFFLINE"));

  const startupState = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    lmstudio: lmOk,
    pgvector: pgAvailable,
    compressionThreshold: COMPRESS_THRESHOLD,
  };
  console.log("[Startup] State:", JSON.stringify(startupState));
});
