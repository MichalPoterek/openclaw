#!/bin/bash

OPENCLAW_PATH="/home/mike/.npm-global/lib/node_modules/openclaw/dist"
LOG_PATH="/home/mike/whatsapp-blackbox/logs"
mkdir -p $LOG_PATH

echo "Searching for WhatsApp handler file..."
# Find the file containing 'messages.upsert' and 'extractText' (unique combo for the handler)
TARGET_FILE=$(grep -l 'messages.upsert' $OPENCLAW_PATH/web-*.js | xargs grep -l 'extractText' | head -n 1)

if [ -z "$TARGET_FILE" ]; then
    echo "❌ Error: Could not find the WhatsApp handler file in $OPENCLAW_PATH"
    exit 1
fi

echo "Found target file: $TARGET_FILE"

# Check if already patched
if grep -q "whatsapp_raw_archive" "$TARGET_FILE"; then
    echo "⚠️ File is already patched. Skipping."
    exit 0
fi

echo "Backing up original file..."
cp "$TARGET_FILE" "$TARGET_FILE.bak"

echo "Injecting Blackbox Logger..."

# We inject the logger at the top of the handleMessagesUpsert function
# This sed command looks for the function definition and inserts our code right after
# Note: This is fragile if minification changes significantly, but works for current build structure

INJECTION='
const fs = await import("node:fs");
const path = await import("node:path");
const archivePath = "/home/mike/whatsapp-blackbox/logs/whatsapp_raw_archive.jsonl";

const archiveMessage = (msg) => {
    try {
        const logEntry = JSON.stringify({
            t: new Date().toISOString(),
            from: msg.key.remoteJid,
            pushName: msg.pushName,
            text: msg.message?.conversation || msg.message?.extendedTextMessage?.text || "media/other"
        }) + "
";
        fs.appendFileSync(archivePath, logEntry);
    } catch (e) { /* ignore logging errors */ }
};
'

# Minified injection (one line) to insert into the JS file
MINIFIED_INJECTION="const fs=await import('node:fs');const archivePath='/home/mike/whatsapp-blackbox/logs/whatsapp_raw_archive.jsonl';const archiveMessage=(m)=>{try{fs.appendFileSync(archivePath,JSON.stringify({t:new Date().toISOString(),from:m.key.remoteJid,name:m.pushName,txt:m.message?.conversation||m.message?.extendedTextMessage?.text||'media'})+'
')}catch(e){}};archiveMessage(msg);"

# Inject right after 'for (const msg of upsert.messages ?? []) {'
sed -i "s/for (const msg of upsert.messages ?? \[\]) {/for (const msg of upsert.messages ?? []) { $MINIFIED_INJECTION/g" "$TARGET_FILE"

if [ $? -eq 0 ]; then
    echo "✓ Patch applied successfully."
    echo "Restarting OpenClaw Gateway..."
    systemctl --user restart openclaw-gateway.service
    echo "Done."
else
    echo "❌ Failed to patch file."
    # Restore backup
    cp "$TARGET_FILE.bak" "$TARGET_FILE"
fi
