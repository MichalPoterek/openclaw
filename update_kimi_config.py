import json
import os

env_path = '/home/mike/agent-zero/usr/.env'
settings_path = '/home/mike/agent-zero/usr/settings.json'

# 1. Update .env
if os.path.exists(env_path):
    with open(env_path, 'r') as f:
        env_lines = f.readlines()
    
    new_env_lines = []
    key_found = False
    for line in env_lines:
        if line.startswith('API_KEY_OTHER='):
            new_env_lines.append('API_KEY_OTHER=sk-kimi-K1pGCuFfoNwDiCXiEdj2wDaP1CPoPgUa4UKmHTmczEiBJMhLhIpcpS98dJehPs1V\n')
            key_found = True
        else:
            new_env_lines.append(line)
    
    if not key_found:
        new_env_lines.append('API_KEY_OTHER=sk-kimi-K1pGCuFfoNwDiCXiEdj2wDaP1CPoPgUa4UKmHTmczEiBJMhLhIpcpS98dJehPs1V\n')
        
    with open(env_path, 'w') as f:
        f.writelines(new_env_lines)
    print("Updated .env with API_KEY_OTHER")

# 2. Update settings.json
if os.path.exists(settings_path):
    with open(settings_path, 'r') as f:
        settings = json.load(f)
    
    settings['chat_model_provider'] = 'other'
    settings['chat_model_name'] = 'kimi-k2.5'
    settings['chat_model_api_base'] = 'https://api.moonshot.cn/v1'
    
    settings['util_model_provider'] = 'other'
    settings['util_model_name'] = 'kimi-k2.5'
    settings['util_model_api_base'] = 'https://api.moonshot.cn/v1'
    
    settings['browser_model_provider'] = 'other'
    settings['browser_model_name'] = 'kimi-k2.5'
    settings['browser_model_api_base'] = 'https://api.moonshot.cn/v1'
    
    with open(settings_path, 'w') as f:
        json.dump(settings, f, indent=4)
    print("Updated settings.json to use 'other' provider with Moonshot API base")
