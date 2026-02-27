import json
import os

env_path = '/home/mike/agent-zero/usr/.env'
settings_path = '/home/mike/agent-zero/usr/settings.json'
kimi_key = 'sk-kimi-K1pGCuFfoNwDiCXiEdj2wDaP1CPoPgUa4UKmHTmczEiBJMhLhIpcpS98dJehPs1V'

# 1. Update .env: Move key back to API_KEY_ANTHROPIC
if os.path.exists(env_path):
    with open(env_path, 'r') as f:
        lines = f.readlines()
    
    clean_lines = []
    for line in lines:
        if not any(line.startswith(p) for p in ['API_KEY_KIMI=', 'API_KEY_ANTHROPIC=', 'API_KEY_OTHER=']):
            clean_lines.append(line)
            
    final_lines = []
    inserted = False
    for line in clean_lines:
        final_lines.append(line)
        if line.startswith('API_KEY_GOOGLE=') and not inserted:
            final_lines.append('API_KEY_ANTHROPIC=' + kimi_key + '\n')
            final_lines.append('API_KEY_OTHER=\n')
            final_lines.append('API_KEY_KIMI=\n')
            inserted = True
            
    with open(env_path, 'w') as f:
        f.writelines(final_lines)
    print("Reverted .env: Key is back in API_KEY_ANTHROPIC")

# 2. Update settings.json: Use 'anthropic' provider
if os.path.exists(settings_path):
    with open(settings_path, 'r') as f:
        settings = json.load(f)
    
    model_name = "kimi-k2.5"
    api_base = "https://api.kimi.com/coding"
    
    for prefix in ['chat', 'util', 'browser']:
        settings[prefix + '_model_provider'] = 'anthropic'
        settings[prefix + '_model_name'] = model_name
        settings[prefix + '_model_api_base'] = api_base
    
    with open(settings_path, 'w') as f:
        json.dump(settings, f, indent=4)
    print("Reverted settings.json: Provider='anthropic', API Base='" + api_base + "'")
