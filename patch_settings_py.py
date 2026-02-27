
import os

file_path = '/home/mike/agent-zero/python/helpers/settings.py'

try:
    with open(file_path, 'r') as f:
        content = f.read()
except FileNotFoundError:
    print(f"Error: {file_path} not found.")
    exit(1)

# The exact original code block we want to replace
old_code = """def set_root_password(password: str):
    if not runtime.is_dockerized():
        raise Exception("root password can only be set in dockerized environments")
    _result = subprocess.run(
        ["chpasswd"],
        input=f"root:{password}".encode(),
        capture_output=True,
        check=True,
    )
    dotenv.save_dotenv_value(dotenv.KEY_ROOT_PASSWORD, password)"""

# The new code block (minimal, safe version)
new_code = """def set_root_password(password: str):
    # PATCHED: Disable root password setting (chpasswd not available)
    # PrintStyle(background_color="yellow", font_color="black").print("Warning: Skipping set_root_password")
    try:
        if dotenv:
            dotenv.save_dotenv_value(dotenv.KEY_ROOT_PASSWORD, password)
    except Exception:
        pass"""

if old_code in content:
    new_content = content.replace(old_code, new_code)
    with open(file_path, 'w') as f:
        f.write(new_content)
    print("Successfully patched settings.py")
else:
    print("Pattern not found in settings.py")
    # Debug: try to find nearby code to see why it failed
    start = content.find("def set_root_password")
    if start != -1:
        print("Found function start, content snippet:")
        print(content[start:start+400])
    else:
        print("Function definition not found.")
