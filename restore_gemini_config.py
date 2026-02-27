import json
import os

def update_openclaw_json(path):
    if not os.path.exists(path):
        return
    with open(path, "r") as f:
        data = json.load(f)

    if "models" not in data:
        data["models"] = {}
    if "providers" not in data["models"]:
        data["models"]["providers"] = {}

    # Correct configuration for Google Gemini in OpenClaw
    data["models"]["providers"]["google"] = {
        "api": "google-generative-ai",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "apiKey": "AIzaSyAXoTHc7gkylA-GaPy_DQ2d64RXQJfu6Hk",
        "models": [
            {
                "id": "gemini-2.0-flash",
                "name": "Gemini 2.0 Flash",
                "contextWindow": 1048576,
                "maxTokens": 8192,
                "input": ["text", "image"]
            }
        ]
    }

    if "agents" in data and "defaults" in data["agents"] and "model" in data["agents"]["defaults"]:
        data["agents"]["defaults"]["model"]["primary"] = "google/gemini-2.0-flash"

    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Updated {path}")

def update_models_json(path):
    if not os.path.exists(path):
        return
    with open(path, "r") as f:
        data = json.load(f)

    if "providers" not in data:
        data["providers"] = {}

    data["providers"]["google"] = {
        "api": "google-generative-ai",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "apiKey": "AIzaSyAXoTHc7gkylA-GaPy_DQ2d64RXQJfu6Hk",
        "models": [
            {
                "id": "gemini-2.0-flash",
                "name": "Gemini 2.0 Flash",
                "contextWindow": 1048576,
                "maxTokens": 8192,
                "input": ["text", "image"],
                "api": "google-generative-ai"
            }
        ]
    }

    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Updated {path}")

update_openclaw_json("/home/mike/.openclaw/openclaw.json")
update_models_json("/home/mike/.openclaw/agents/main/agent/models.json")
