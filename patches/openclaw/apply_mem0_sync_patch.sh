#!/bin/bash

# Define paths
OPENCLAW_HOOK_DIR="/home/mike/.npm-global/lib/node_modules/openclaw/dist/bundled/session-memory"
TARGET_FILE="$OPENCLAW_HOOK_DIR/handler.js"
BACKUP_FILE="$TARGET_FILE.bak"

echo "Applying Enhanced Mem0 Sync Patch to OpenClaw..."

# Backup original file
if [ ! -f "$BACKUP_FILE" ]; then
    echo "Backing up original handler to $BACKUP_FILE"
    cp "$TARGET_FILE" "$BACKUP_FILE"
fi

# Create new handler code with Mem0 integration AND broader triggers
cat << 'JAVASCRIPT' > "$TARGET_FILE"
import { s as resolveStateDir } from "../../paths-CyR9Pa1R.js";
import { d as resolveAgentIdFromSessionKey } from "../../session-key-CgcjHuX_.js";
import { s as resolveAgentWorkspaceDir } from "../../agent-scope-CHHM9qlY.js";
import { c as createSubsystemLogger } from "../../exec-CTJFoTnU.js";
import { K as hasInterSessionUserProvenance } from "../../pi-embedded-n26FO9Pa.js";
import { generateSlugViaLLM } from "../../llm-slug-generator.js";
import { t as resolveHookConfig } from "../../config-juH0T5BE.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const log = createSubsystemLogger("hooks/session-memory");

/**
 * Helper to send memories to Mem0 via HTTP API
 */
async function syncToMem0(content, agentId) {
    if (!content || content.length < 50) return; 

    // Construct a Prompt that forces extraction of durable facts
    const mem0Payload = JSON.stringify({
        messages: [{ role: "user", content: `Analyze the following conversation session. Extract ONLY facts, user preferences, project details, and critical context that should be remembered long-term. Ignore casual chit-chat.\n\nConversation:\n${content}` }],
        user_id: "mike", 
        agent_id: agentId,
        output_format: "v1.1" 
    });

    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 8765,
            path: '/api/v1/memories/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(mem0Payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    log.info("Successfully synced distilled memory to Mem0");
                    resolve(data);
                } else {
                    log.warn(`Mem0 sync failed with status ${res.statusCode}: ${data}`);
                    resolve(null); 
                }
            });
        });

        req.on('error', (e) => {
            log.error(`Mem0 connection error: ${e.message}`);
            resolve(null);
        });

        req.write(mem0Payload);
        req.end();
    });
}

async function getRecentSessionContent(sessionFilePath, messageCount = 100) { // Increased to 100 for broader context
    try {
        const lines = (await fs.readFile(sessionFilePath, "utf-8")).trim().split("\n");
        const allMessages = [];
        for (const line of lines) try {
            const entry = JSON.parse(line);
            if (entry.type === "message" && entry.message) {
                const msg = entry.message;
                const role = msg.role;
                if ((role === "user" || role === "assistant") && msg.content) {
                    if (role === "user" && hasInterSessionUserProvenance(msg)) continue;
                    const text = Array.isArray(msg.content) ? msg.content.find((c) => c.type === "text")?.text : msg.content;
                    if (text && !text.startsWith("/")) allMessages.push(`${role}: ${text}`);
                }
            }
        } catch {}
        return allMessages.slice(-messageCount).join("\n");
    } catch {
        return null;
    }
}

const saveSessionToMemory = async (event) => {
    // UPDATED TRIGGER LOGIC:
    // Allow:
    // 1. Command /new
    // 2. Lifecycle events (session_end)
    // 3. Flush actions (memory compaction)
    
    const isCommandNew = event.type === "command" && event.action === "new";
    const isLifecycle = event.type === "lifecycle" || event.action === "session_end";
    const isFlush = event.action === "flush" || event.action === "compact";
    
    if (!isCommandNew && !isLifecycle && !isFlush) {
        // Log skipped events to debug if we are missing something
        // log.debug(`Skipping event: type=${event.type}, action=${event.action}`);
        return;
    }
    
    try {
        log.info(`Hook triggered by [${event.type}:${event.action}]. Saving session and syncing to Mem0.`);
        const context = event.context || {};
        const cfg = context.cfg;
        const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
        const workspaceDir = cfg ? resolveAgentWorkspaceDir(cfg, agentId) : path.join(resolveStateDir(process.env, os.homedir), "workspace");
        const memoryDir = path.join(workspaceDir, "memory");
        await fs.mkdir(memoryDir, { recursive: true });
        
        const now = new Date(event.timestamp);
        const dateStr = now.toISOString().split("T")[0];
        const sessionEntry = context.previousSessionEntry || context.sessionEntry || {};
        const sessionFile = sessionEntry.sessionFile;
        
        let sessionContent = null;
        if (sessionFile) {
            sessionContent = await getRecentSessionContent(sessionFile, 100); 
        }

        // --- Mem0 Integration ---
        if (sessionContent) {
            log.info("Distilling session content for Mem0...");
            // Fire and forget (don't await) to speed up UI response
            syncToMem0(sessionContent, agentId).catch(err => log.error("Async Mem0 sync error", err));
        }
        // ------------------------

        // Standard file saving logic...
        let slug = null;
        const hookConfig = resolveHookConfig(cfg, "session-memory");
        const allowLlmSlug = !(process.env.OPENCLAW_TEST_FAST === "1") && hookConfig?.llmSlug !== false;
        
        if (sessionContent && cfg && allowLlmSlug) {
             try {
                slug = await generateSlugViaLLM({ sessionContent, cfg });
             } catch(e) { log.warn("Slug generation failed", e); }
        }
        
        if (!slug) {
            slug = now.toISOString().split("T")[1].split(".")[0].replace(/:/g, "").slice(0, 4);
        }
        
        const filename = `${dateStr}-${slug}.md`;
        const memoryFilePath = path.join(memoryDir, filename);
        
        const entryParts = [
            `# Session: ${dateStr}`,
            "",
            `- **Trigger**: ${event.type}/${event.action}`,
            `- **Session Key**: ${event.sessionKey}`,
            ""
        ];
        if (sessionContent) entryParts.push("## Conversation Summary", "", sessionContent, "");
        
        await fs.writeFile(memoryFilePath, entryParts.join("\n"), "utf-8");
        log.info(`Session backed up to ${filename}`);

    } catch (err) {
        log.error("Failed to save session memory", { error: String(err) });
    }
};

export { saveSessionToMemory as default };
JAVASCRIPT

echo "✓ Enhanced Patch applied. Restarting OpenClaw..."
systemctl --user restart openclaw-gateway.service
echo "Done."
