import sys

f_path = "/home/mike/gemini-bridge-oauth/index.cjs"
with open(f_path, "r", encoding="utf-8") as f:
    content = f.read()

old = 'app.use((req, res, next) => { console.log(`
--- Inbound ${req.method} ${req.url} ---`); next(); });'
new = 'app.use((req, res, next) => { console.log(`
--- Inbound ${req.method} ${req.url} ---
`, JSON.stringify(req.body, null, 2)); next(); });'

if old in content:
    content = content.replace(old, new)
    with open(f_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("Logging added successfully")
else:
    # Try alternate match if formatting differs
    content = content.replace("--- Inbound ${req.method} ${req.url} ---", "--- Inbound ${req.method} ${req.url} ---
`, JSON.stringify(req.body, null, 2)")
    with open(f_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("Logging injection attempted via fallback")
