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
    kimi_key_found = False
    for line in env_lines:
        if line.startswith('API_KEY_KIMI='):
            new_env_lines.append('API_KEY_KIMI=' + kimi_key + '\n')
            kimi_key_found = True
        else:
            new_env_lines.append(line)
    
    if not kimi_key_found:
        new_env_lines.append('API_KEY_KIMI=' + kimi_key + '\n')
        
    with open(env_path, 'w') as f:
        f.writelines(new_env_lines)
    print("Updated .env")

# 2. Update settings.json
if os.path.exists(settings_path):
    with open(settings_path, 'r') as f:
        settings = json.load(f)
    
    model_name = "kimi-k2.5"
    
    settings['chat_model_provider'] = 'kimi'
    settings['chat_model_name'] = model_name
    settings['chat_model_api_base'] = ""
    
    settings['util_model_provider'] = 'kimi'
    settings['util_model_name'] = model_name
    settings['util_model_api_base'] = ""
    
    settings['browser_model_provider'] = 'kimi'
    settings['browser_model_name'] = model_name
    settings['browser_model_api_base'] = ""
    
    with open(settings_path, 'w') as f:
        json.dump(settings, f, indent=4)
    print("Updated settings.json")
