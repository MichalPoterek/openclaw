import yaml
import os

path = '/home/mike/agent-zero/conf/model_providers.yaml'
if not os.path.exists(path):
    print("File not found: " + path)
    exit(1)

with open(path, 'r', encoding='utf-8') as f:
    data = yaml.safe_load(f)

# Add Kimi to chat providers
if 'kimi' not in data['chat']:
    data['chat']['kimi'] = {
        'name': 'Kimi AI',
        'litellm_provider': 'openai',
        'kwargs': {
            'api_base': 'https://api.kimi.com/coding'
        }
    }
    with open(path, 'w', encoding='utf-8') as f:
        yaml.dump(data, f, sort_keys=False)
    print("Added 'kimi' to model_providers.yaml")
else:
    print("'kimi' already exists in model_providers.yaml")
