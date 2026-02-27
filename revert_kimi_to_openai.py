import yaml
import os

path = '/home/mike/agent-zero/conf/model_providers.yaml'
if not os.path.exists(path):
    print("File not found: " + path)
    exit(1)

with open(path, 'r', encoding='utf-8') as f:
    data = yaml.safe_load(f)

# Change litellm_provider back to openai
if 'kimi' in data['chat']:
    data['chat']['kimi']['litellm_provider'] = 'openai'
    data['chat']['kimi']['name'] = 'Kimi AI'
    data['chat']['kimi']['kwargs'] = {
        'api_base': 'https://api.kimi.com/coding'
    }
    
    with open(path, 'w', encoding='utf-8') as f:
        yaml.dump(data, f, sort_keys=False)
    print("Successfully updated 'kimi' provider to use 'openai' logic.")
else:
    print("'kimi' provider not found in YAML")
