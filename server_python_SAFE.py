from mcp.server.fastmcp import FastMCP
import httpx
import asyncio
import os

# Konfiguracja
API_URL = "http://127.0.0.1:3006"
PORT = 3008
API_KEY = "fc-selfhosted"

# Inicjalizacja serwera FastMCP
mcp = FastMCP("firecrawl-python", version="1.0.0")

@mcp.tool()
async def firecrawl_search(query: str, limit: int = 5) -> str:
    """Search using Firecrawl SDK (Native Python)."""
    print(f"[Python SDK] Searching: {query}")
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                f"{API_URL}/v1/search",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {API_KEY}"
                },
                json={
                    "query": query,
                    "limit": limit,
                    "scrapeOptions": {"formats": ["markdown"]}
                }
            )
            
            if response.status_code != 200:
                return f"Search Failed: API returned {response.status_code}"
                
            data = response.json()
            
            if not data.get("success"):
                return f"Search Failed: {data.get('error', 'Unknown error')}"
                
            results = data.get("data", [])
            if not results:
                return "No results found."
                
            # Formatowanie Markdown
            output = []
            for item in results:
                title = item.get("title", "No Title")
                link = item.get("url", "#")
                desc = item.get("description", "")
                # Safe markdown handling
                md_content = item.get("markdown", "")
                if md_content:
                    md_content = md_content[:1000]
                
                entry = f"## [{title}]({link})
{desc}

{md_content}
---"
                output.append(entry)
                
            return "
".join(output)

        except Exception as e:
            print(f"[Python SDK] Error: {e}")
            return f"SDK Exception: {str(e)}"

@mcp.tool()
async def firecrawl_scrape(url: str) -> str:
    """Scrape a URL using Firecrawl SDK."""
    print(f"[Python SDK] Scraping: {url}")
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                f"{API_URL}/v1/scrape",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {API_KEY}"
                },
                json={
                    "url": url,
                    "formats": ["markdown"]
                }
            )
            
            if response.status_code != 200:
                return f"Scrape Failed: API returned {response.status_code}"
                
            data = response.json()
            
            if not data.get("success"):
                return f"Scrape Failed: {data.get('error', 'Unknown error')}"
                
            return data.get("data", {}).get("markdown", "No content returned.")

        except Exception as e:
            return f"SDK Scrape Error: {str(e)}"

if __name__ == "__main__":
    print(f"Starting Python MCP Server on port {PORT}...")
    mcp.run(transport="sse")
