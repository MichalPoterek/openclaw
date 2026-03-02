import requests
import time
import json
import os

VLLM_ENDPOINT = "http://172.16.0.118:8000/v1/chat/completions"
VLLM_API_KEY = os.environ.get("VLLM_API_KEY", "changeme")
VLLM_MODEL = "Qwen-32B-Turbo"

def test_speed():
    prompt = "Write a very long, detailed story about a space explorer discovering a new planet. Be extremely descriptive."
    payload = {
        "model": VLLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 500,
        "temperature": 0.7
    }
    
    headers = {
        "Authorization": f"Bearer {VLLM_API_KEY}",
        "Content-Type": "application/json"
    }

    print(f"Connecting to vLLM at {VLLM_ENDPOINT}...")
    start_time = time.time()
    
    try:
        response = requests.post(VLLM_ENDPOINT, json=payload, headers=headers, timeout=60)
        end_time = time.time()
        
        if response.status_code == 200:
            result = response.json()
            tokens = result['usage']['completion_tokens']
            duration = end_time - start_time
            tps = tokens / duration
            
            print("\n--- RESULTS ---")
            print(f"Tokens generated: {tokens}")
            print(f"Total duration: {duration:.2f} s")
            print(f"Speed: {tps:.2f} tokens/second")
            print(f"First 100 chars of response: {result['choices'][0]['message']['content'][:100]}...")
        else:
            print(f"Error: {response.status_code} - {response.text}")
            
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    test_speed()
