from mcp.server.fastmcp import FastMCP
import httpx
import asyncio
import os

# Konfiguracja
API_URL = "http://127.0.0.1:3006"
PORT = 3008
API_KEY = "fc-selfhosted"

mcp = FastMCP("firecrawl-python")

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
                return "Search Failed: API returned " + str(response.status_code)
                
            data = response.json()
            if not data.get("success"):
                return "Search Failed: " + str(data.get("error", "Unknown error"))
                
            results = data.get("data", [])
            if not results:
                return "No results found. (SearXNG returned empty list)"
                
            output = []
            for item in results:
                title = item.get("title") or "No Title"
                link = item.get("url") or "#"
                desc = item.get("description") or "No description"
                md_content = item.get("markdown") or ""
                
                # Zabezpieczenie przed pustymi polami
                if len(md_content) > 1000:
                    md_content = md_content[:1000] + "..."
                
                entry = "## [" + title + "](" + link + ")
" + desc + "

" + md_content + "
---"
                output.append(entry)
                
            return "
".join(output)

        except Exception as e:
            return "SDK Exception: " + str(e)

if __name__ == "__main__":
    mcp.settings.port = PORT
    mcp.settings.host = "0.0.0.0" 
    mcp.run(transport="sse")
