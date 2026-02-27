import os

path = '/home/mike/agent-zero/agent.py'
if not os.path.exists(path):
    print("File not found: " + path)
    exit(1)

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
found = False
for i in range(len(lines)):
    line = lines[i]
    if 'def get_agent(self):' in line:
        new_lines.append(line)
        # Skip the next line which is the old return
        if i + 1 < len(lines) and 'return self.streaming_agent or self.agent0' in lines[i+1]:
            new_lines.append('        if not hasattr(self, "agent0") or self.agent0 is None:\n')
            new_lines.append('            self.agent0 = Agent(0, self.config, self)\n')
            new_lines.append('        return self.streaming_agent or self.agent0\n')
            found = True
            # We skip the original return line in the next iteration by using a manual index if we wanted, 
            # but let's just use a flag to skip the next line.
            lines[i+1] = "" # effectively skip it
        else:
            # Fallback if structure is slightly different
            pass
    elif line != "":
        new_lines.append(line)

if found:
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print("Successfully patched agent.py")
else:
    print("Could not find the pattern to patch.")
