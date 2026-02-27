import json
import os

env_path = '/home/mike/agent-zero/usr/.env'
settings_path = '/home/mike/agent-zero/usr/settings.json'
kimi_key = 'sk-kimi-K1pGCuFfoNwDiCXiEdj2wDaP1CPoPgUa4UKmHTmczEiBJMhLhIpcpS98dJehPs1V'

# 1. Update .env
if os.path.exists(env_path):
    with open(env_path, 'r') as f:
        env_lines = f.readlines()
    
    new_env_lines = []
    anthropic_found = False
    for line in env_lines:
        if line.startswith('API_KEY_ANTHROPIC='):
            new_env_lines.append('API_KEY_ANTHROPIC=' + kimi_key + '\n')
            anthropic_found = True
        elif line.startswith('API_KEY_OTHER='):
            new_env_lines.append('API_KEY_OTHER=\n')
        else:
            new_env_lines.append(line)
    
    if not anthropic_found:
        new_env_lines.append('API_KEY_ANTHROPIC=' + kimi_key + '\n')
        
    with open(env_path, 'w') as f:
        f.writelines(new_env_lines)
    print("Updated .env")

# 2. Update settings.json
if os.path.exists(settings_path):
    with open(settings_path, 'r') as f:
        settings = json.load(f)
    
    api_base = "https://api.kimi.com/coding"
    
    settings['chat_model_provider'] = 'anthropic'
    settings['chat_model_name'] = 'kimi-k2.5'
    settings['chat_model_api_base'] = api_base
    
    settings['util_model_provider'] = 'anthropic'
    settings['util_model_name'] = 'kimi-k2.5'
    settings['util_model_api_base'] = api_base
    
    settings['browser_model_provider'] = 'anthropic'
    settings['browser_model_name'] = 'kimi-k2.5'
    settings['browser_model_api_base'] = api_base
    
    with open(settings_path, 'w') as f:
        json.dump(settings, f, indent=4)
    print("Updated settings.json")
