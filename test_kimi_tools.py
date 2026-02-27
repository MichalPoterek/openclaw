#!/usr/bin/env python3
"""Test Kimi web session with Firecrawl and Mem0 tools."""
import asyncio
import json
import ssl
import websockets
import time
import uuid
import base64
import http.client

async def send_prompt(session_id, prompt, timeout=60):
    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE
    auth = base64.b64encode(b"mike:mike7106").decode()
    WS_URL = f"wss://172.16.192.94:5495/api/sessions/{session_id}/stream?token=kimi-web-2026"

    async with websockets.connect(
        WS_URL, ssl=ssl_ctx,
        additional_headers={"Authorization": f"Basic {auth}"},
        max_size=10*1024*1024,
    ) as ws:
        await ws.send(json.dumps({
            "jsonrpc": "2.0", "method": "initialize",
            "id": str(uuid.uuid4()),
            "params": {"protocol_version": "1.3", "client": {"name": "test", "version": "1.0"}}
        }))
        start = time.time()
        while time.time() - start < 5:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                if "result" in json.loads(raw):
                    break
            except asyncio.TimeoutError:
                continue

        send_time = time.time()
        await ws.send(json.dumps({
            "jsonrpc": "2.0", "method": "prompt",
            "id": str(uuid.uuid4()),
            "params": {"user_input": [{"type": "text", "text": prompt}]}
        }))

        tools_used = []
        response_text = []
        while time.time() - send_time < timeout:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                d = json.loads(raw)
                method = d.get("method", "")
                elapsed = round(time.time() - send_time, 1)
                if method == "session_status":
                    state = d["params"]["state"]
                    reason = d["params"].get("reason", "")
                    if state == "idle" and "complete" in reason:
                        return elapsed, tools_used, "".join(response_text)
                elif method == "event":
                    et = d["params"].get("type", "")
                    payload = d["params"].get("payload", {})
                    if et == "ToolCall":
                        name = payload.get("function", {}).get("name", "?")
                        tools_used.append(name)
                    elif et == "ContentPart":
                        response_text.append(payload.get("text", ""))
                    elif et == "ToolConfirmationRequest":
                        return elapsed, ["BLOCKED-NEEDS-APPROVAL"], "Tool approval required!"
            except asyncio.TimeoutError:
                continue
        return timeout, tools_used, "".join(response_text) or "TIMEOUT"

async def main():
    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE
    auth = base64.b64encode(b"mike:mike7106").decode()

    # Create session
    conn = http.client.HTTPSConnection("172.16.192.94", 5495, context=ssl_ctx)
    conn.request("POST", "/api/sessions/?token=kimi-web-2026",
                 body=json.dumps({"work_dir": "/home/mike"}),
                 headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"})
    resp = conn.getresponse()
    session = json.loads(resp.read())
    sid = session.get("session_id", "")
    conn.close()
    print(f"Session: {sid}\n")
    await asyncio.sleep(2)

    tests = [
        ("Firecrawl scrape", "Use firecrawl_scrape to scrape https://example.com. Just tell me the title."),
        ("Mem0 save", "Use add_memories to save: Mike prefers Python over JavaScript"),
        ("Mem0 search", "Use search_memory to search for Python. Show what you find."),
        ("Mem0 list", "Use list_memories to list all memories. Show the count."),
    ]

    for name, prompt in tests:
        print(f"--- {name} ---")
        elapsed, tools, text = await send_prompt(sid, prompt)
        status = "OK" if elapsed < 30 and "BLOCKED" not in str(tools) and "TIMEOUT" not in text else "FAIL"
        print(f"  Time: {elapsed}s | Tools: {tools} | Status: {status}")
        print(f"  Response: {text[:120]}")
        print()
        await asyncio.sleep(1)

    # Cleanup: delete test memory
    print("--- Mem0 cleanup ---")
    elapsed, tools, text = await send_prompt(sid, "Use delete_all_memories to delete all memories")
    print(f"  Time: {elapsed}s | Tools: {tools}")
    print(f"  Response: {text[:120]}")

if __name__ == "__main__":
    asyncio.run(main())
