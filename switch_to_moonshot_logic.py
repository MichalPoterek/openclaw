import yaml
import os

path = '/home/mike/agent-zero/conf/model_providers.yaml'
if not os.path.exists(path):
    print("File not found: " + path)
    exit(1)

with open(path, 'r', encoding='utf-8') as f:
    data = yaml.safe_load(f)

# Change litellm_provider to moonshot
if 'kimi' in data['chat']:
    data['chat']['kimi']['litellm_provider'] = 'moonshot'
    # We keep the api_base since you want the /coding endpoint
    
    with open(path, 'w', encoding='utf-8') as f:
        yaml.dump(data, f, sort_keys=False)
    print("Changed 'kimi' litellm_provider to 'moonshot'")
else:
    print("'kimi' provider not found in YAML")
