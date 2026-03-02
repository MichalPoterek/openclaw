import json
import os

path = '/home/mike/.openclaw/openclaw.json'
if os.path.exists(path):
    with open(path, 'r') as f:
        data = json.load(f)

    # Switch primary brain to Flash for speed
    data.setdefault('agents', {}).setdefault('defaults', {}).setdefault('model', {})['primary'] = 'gemini-bridge/gemini-2.5-flash'
    
    print('Switched primary model to gemini-2.5-flash.')

    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print('Configuration updated.')
else:
    print('Config file not found.')
