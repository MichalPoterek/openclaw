import requests
import json

def search(query: str, limit: int = 5):
    """
    Perform a web search using the local Firecrawl API (Native).
    Args:
        query: The search query string.
        limit: Number of results to return (default: 5).
    """
    url = 'http://127.0.0.1:3006/v1/search'
    headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer fc-selfhosted'
    }
    data = {
        'query': query,
        'limit': limit,
        'scrapeOptions': {
            'formats': ['markdown']
        }
    }
    
    try:
        print(f'[Firecrawl Native] Searching: {query}')
        response = requests.post(url, headers=headers, json=data, timeout=60)
        
        if response.status_code != 200:
            return f'Error: API returned status {response.status_code}'
            
        result = response.json()
        if not result.get('success'):
            return f'Error: {result.get("error")}'
            
        output = []
        for item in result.get('data', []):
            title = item.get('title', 'No Title')
            link = item.get('url', '#')
            desc = item.get('description', '')
            content = item.get('markdown', '')[:1500]
            output.append(f'## [{title}]({link})
{desc}

{content}
---')
            
        return '
'.join(output) if output else 'No results found.'

    except Exception as e:
        return f'Error: {str(e)}'

def scrape(url: str):
    """
    Scrape a single URL using the local Firecrawl API (Native).
    Args:
        url: The URL to scrape.
    """
    api_url = 'http://127.0.0.1:3006/v1/scrape'
    headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer fc-selfhosted'
    }
    data = {
        'url': url,
        'formats': ['markdown']
    }
    
    try:
        response = requests.post(api_url, headers=headers, json=data, timeout=60)
        if response.status_code != 200:
            return f'Error: API returned status {response.status_code}'
            
        result = response.json()
        if not result.get('success'):
            return f'Error: {result.get("error")}'
            
        return result.get('data', {}).get('markdown', 'No content returned.')

    except Exception as e:
        return f'Error: {str(e)}'
