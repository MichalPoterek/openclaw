import yaml
import os

path = '/home/mike/agent-zero/conf/model_providers.yaml'
if not os.path.exists(path):
    print("File not found: " + path)
    exit(1)

with open(path, 'r', encoding='utf-8') as f:
    data = yaml.safe_load(f)

# Update LM Studio provider logic
if 'lm_studio' in data['chat']:
    data['chat']['lm_studio']['litellm_provider'] = 'openai' # More reliable for remote LM Studio
    data['chat']['lm_studio']['kwargs'] = {
        'api_base': 'http://192.168.3.24:1234/v1'
    }
    
    with open(path, 'w', encoding='utf-8') as f:
        yaml.dump(data, f, sort_keys=False)
    print("Updated 'lm_studio' provider in model_providers.yaml")
else:
    print("'lm_studio' provider not found in YAML")
