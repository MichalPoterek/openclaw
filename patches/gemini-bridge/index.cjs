const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");

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
const LMSTUDIO_COMPRESS_TIMEOUT = 15000;

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

// Single model chain — all models ordered by capability (strongest → weakest)
// Each model has its OWN quota pool, so fallback cycles through fresh limits
const MODEL_CHAIN = [
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

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

// Three routing modes — same chain, different thinking:
//   1. "pro" models           → thinking ON  (main agents)
//   2. "flash/lite" models    → thinking OFF (fast sub-agents)
//   3. "flash/lite" + "think" → thinking ON  (sub-agents needing reasoning)
function getModelChain(requestedModel) {
  const m = requestedModel.toLowerCase();

  // Flash/lite with thinking (explicit: name contains "think" suffix)
  if ((m.includes("flash") || m.includes("lite")) && m.includes("think")) {
    return { chain: MODEL_CHAIN, type: "thinking-sub", thinking: true };
  }
  // Pro models → always thinking (main agents)
  if (m.includes("pro")) {
    return { chain: MODEL_CHAIN, type: "thinking-main", thinking: true };
  }
  // Flash/lite → no thinking (fast sub-agents)
  if (m.includes("flash") || m.includes("lite")) {
    return { chain: MODEL_CHAIN, type: "fast-sub", thinking: false };
  }
  // Default: thinking on
  return { chain: MODEL_CHAIN, type: "thinking-main", thinking: true };
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

  _hash(model, messages) {
    const tail = messages.slice(-CACHE_KEY_MESSAGES);
    const content = tail.map(m => {
      const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${m.role}:${c}`;
    }).join("|");
    return crypto.createHash("sha256").update(`${model}||${content}`).digest("hex");
  }

  get(model, messages) {
    const key = this._hash(model, messages);
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
    console.log(`[Cache HIT] key=${key.substring(0, 12)}... source=${entry.source} age=${Math.round((Date.now() - entry.timestamp) / 1000)}s`);
    return entry.response;
  }

  set(model, messages, response, source) {
    const key = this._hash(model, messages);
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
// CONTEXT OPTIMIZER (via LM Studio)
// ============================================================
async function optimizeContextWithLocalLLM(contents) {
  try {
    if (!(await checkLMStudioHealth())) return contents;

    let rawHistory = "";
    contents.forEach(c => {
      if (c.parts && c.parts[0] && c.parts[0].text) {
        rawHistory += `Role: ${c.role}\nContent: ${c.parts[0].text}\n\n`;
      }
    });

    if (rawHistory.length < 2000) return contents;

    console.log("[Optimizer] Compressing context via LM Studio...");

    const optimizerPrompt = "You are a Context Management AI. Compress this chat history.\n" +
      "Rules:\n" +
      "1. Keep the exact intent of the final user message.\n" +
      "2. Summarize previous turns to retain key facts but remove fluff.\n" +
      "3. Remove repetitive system logs.\n" +
      "4. Do NOT answer the user's question. ONLY output the compressed history.\n\n" +
      "History to compress:\n" + rawHistory.substring(0, 30000);

    const response = await axios.post(LMSTUDIO_ENDPOINT, {
      messages: [{ role: "user", content: optimizerPrompt }],
      temperature: 0.1,
      max_tokens: 2000,
    }, {
      headers: { "Authorization": `Bearer ${LMSTUDIO_API_KEY}`, "Content-Type": "application/json" },
      timeout: LMSTUDIO_COMPRESS_TIMEOUT,
    });

    const compressedText = response.data.choices[0].message.content;
    console.log("[Optimizer] Context compressed successfully.");
    return [
      { role: "user", parts: [{ text: "Previous Context Summary:\n" + compressedText }] },
      contents[contents.length - 1],
    ];
  } catch (error) {
    console.warn("[Optimizer] Failed, using original context.", error.message);
    return contents;
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
  res.json({
    status: "ok",
    cache: cache.stats(),
    rateLimit: getRateStatus(),
    lmstudio: { available: lmOk, endpoint: LMSTUDIO_ENDPOINT },
    geminiOAuth: { endpoint: CODE_ASSIST_ENDPOINT },
    modelChain: MODEL_CHAIN,
    thinkingBudget: DEFAULT_THINKING_BUDGET,
    tiers: [
      "1: Main agent (thinking ON):  " + MODEL_CHAIN.join(" → "),
      "2: Sub-agent (thinking OFF):  " + MODEL_CHAIN.join(" → "),
      "3: Sub-agent (thinking ON):   " + MODEL_CHAIN.join(" → "),
      "4: LM Studio Qwen 30B (unlimited, with tools) [simple queries + fallback]",
    ],
  });
});

app.post("/v1/chat/completions", async (req, res) => {
  const providedKey = req.headers["x-api-key"]
    || (req.headers["authorization"] ? req.headers["authorization"].replace("Bearer ", "") : null)
    || req.query.key;
  if (providedKey !== BRIDGE_API_KEY) return res.status(401).json({ error: "Unauthorized" });

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
    // ---- Step 1: Check cache ----
    // Cache check works for ALL requests (including those with tools,
    // keyed on messages only — tools don't change the answer for same input)
    const cached = cache.get(model, filteredMessages);
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
        const lmResp = await callLMStudio(filteredMessages, systemInstruction, openAiTools);
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
        const lmResp = await callLMStudio(filteredMessages, systemInstruction, openAiTools);
        response = formatLMStudioAsOpenAI(lmResp, model);
      } catch (err) {
        console.warn("[Router] LM Studio failed.", err.message, err.response?.data ? JSON.stringify(err.response.data).substring(0, 300) : "");
      }
    }

    // ---- Step 3: Gemini OAuth (primary) with retry + model fallback ----
    if (!response && rate.level === "ok") {
      console.log("[Router] -> Gemini OAuth");
      const contents = transformInputToContents(filteredMessages);
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
        const lmResp = await callLMStudio(filteredMessages, systemInstruction, openAiTools);
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
        cache.set(model, filteredMessages, response, response._source || "unknown");
      } else {
        console.log("[Cache] Skipping cache for tool_call response");
      }
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
// START
// ============================================================
app.listen(PORT, () => {
  console.log("");
  console.log("=== Gemini Bridge (OAuth + LM Studio) ===");
  console.log("Port: " + PORT);
  console.log("Tier 1: OAuth Cloud Code Assist — " + CODE_ASSIST_ENDPOINT);
  console.log("  Model chain: " + MODEL_CHAIN.join(" → "));
  console.log("  Main agent:  thinking ON  | Sub-agent: thinking OFF | Sub-thinking: thinking ON");
  console.log("  Thinking: " + DEFAULT_THINKING_BUDGET + " tokens (2.5), HIGH level (3.x)");
  console.log("  Retry: Phase 1 (try all) + Phase 2 (wait+retry)");
  console.log("  User-Agent: GeminiCLI/" + GEMINI_CLI_VERSION);
  console.log("Tier 2: LM Studio (Qwen 30B) — " + LMSTUDIO_ENDPOINT);
  console.log("Cache: " + CACHE_MAX_SIZE + " entries, " + (CACHE_TTL_MS / 1000) + "s TTL");
  console.log("No API keys — OAuth only.");
  console.log("=========================================");
  console.log("");
  checkLMStudioHealth().then(ok => console.log("[Startup] LM Studio: " + (ok ? "ONLINE" : "OFFLINE")));
});
