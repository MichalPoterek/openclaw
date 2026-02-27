import os

env_path = '/home/mike/agent-zero/usr/.env'
lm_key = 'sk-lm-QcLLTVfS:rIlPZDZzSH9u1esVHHLu'

if os.path.exists(env_path):
    with open(env_path, 'r') as f:
        lines = f.readlines()
    
    new_lines = []
    found = False
    for line in lines:
        if line.startswith('API_KEY_LM_STUDIO='):
            new_lines.append('API_KEY_LM_STUDIO=' + lm_key + '\n')
            found = True
        else:
            new_lines.append(line)
    
    if not found:
        new_lines.append('API_KEY_LM_STUDIO=' + lm_key + '\n')
        
    with open(env_path, 'w') as f:
        f.writelines(new_lines)
    print("Updated .env")
else:
    print(".env not found")
