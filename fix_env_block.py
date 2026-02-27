import json
import os

env_path = '/home/mike/agent-zero/usr/.env'
settings_path = '/home/mike/agent-zero/usr/settings.json'
kimi_key = 'sk-kimi-K1pGCuFfoNwDiCXiEdj2wDaP1CPoPgUa4UKmHTmczEiBJMhLhIpcpS98dJehPs1V'

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
            final_lines.append('API_KEY_ANTHROPIC=\n')
            final_lines.append('API_KEY_OTHER=\n')
            final_lines.append('API_KEY_KIMI=' + kimi_key + '\n')
            inserted = True
            
    with open(env_path, 'w') as f:
        f.writelines(final_lines)
    print("Cleaned and organized .env")

if os.path.exists(settings_path):
    with open(settings_path, 'r') as f:
        settings = json.load(f)
    for p in ['chat', 'util', 'browser']:
        settings[p + '_model_provider'] = 'kimi'
        settings[p + '_model_name'] = 'kimi-k2.5'
        settings[p + '_model_api_base'] = ""
    with open(settings_path, 'w') as f:
        json.dump(settings, f, indent=4)
    print("Updated settings.json")
