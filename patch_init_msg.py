import os

path = '/home/mike/agent-zero/python/extensions/agent_init/_10_initial_message.py'
if not os.path.exists(path):
    print("File not found: " + path)
    exit(1)

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# The fix: Strip markdown code blocks before json.loads
old_code = 'initial_message_json = json.loads(initial_message)'
new_code = '''        # strip markdown code blocks if present
        json_str = initial_message.strip()
        if json_str.startswith("```json"):
            json_str = json_str[7:]
        if json_str.endswith("```"):
            json_str = json_str[:-3]
        json_str = json_str.strip()
        
        initial_message_json = json.loads(json_str)'''

if old_code in content:
    content = content.replace(old_code, new_code)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Successfully patched _10_initial_message.py")
else:
    print("Could not find the target line to patch.")
