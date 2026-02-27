import requests
import json

API_URL = "http://127.0.0.1:3006/v1/search"
API_KEY = "fc-selfhosted"

def debug_search():
    print(f"Testing API: {API_URL}")
    try:
        response = requests.post(
            API_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {API_KEY}"
            },
            json={
                "query": "test",
                "limit": 1,
                "scrapeOptions": {"formats": ["markdown"]}
            },
            timeout=10
        )
        
        print(f"Status Code: {response.status_code}")
        try:
            data = response.json()
            print("Response Keys:", list(data.keys()))
            
            if 'data' in data:
                print(f"Data type: {type(data['data'])}")
                if isinstance(data['data'], list) and len(data['data']) > 0:
                    print("First Item Keys:", list(data['data'][0].keys()))
                    print("First Item Sample:", json.dumps(data['data'][0], indent=2)[:500])
                else:
                    print("Data list is empty or not a list.")
            else:
                print("No 'data' key in response.")
                print("Full Response:", json.dumps(data, indent=2))
                
        except json.JSONDecodeError:
            print("Response is not JSON:", response.text[:500])
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    debug_search()
