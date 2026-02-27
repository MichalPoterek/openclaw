from mcp.server.fastmcp import FastMCP
import httpx
import mcp.types as types

# Konfiguracja
API_URL = "http://127.0.0.1:3006"
PORT = 3008
API_KEY = "fc-selfhosted"

mcp = FastMCP("firecrawl-python")

@mcp.tool()
async def firecrawl_search(query: str, limit: int = 5) -> list[types.TextContent]:
    """Search using Firecrawl SDK. Returns separate content blocks for each result."""
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
                return [types.TextContent(type="text", text=f"Error: API returned {response.status_code}")]
                
            data = response.json()
            if not data.get("success"):
                return [types.TextContent(type="text", text=f"Error: {data.get('error')}")]
                
            results = data.get("data", [])
            if not results:
                return [types.TextContent(type="text", text="No results found.")]
                
            content_list = []
            for item in results:
                title = item.get("title") or "No Title"
                link = item.get("url") or "#"
                desc = item.get("description") or "No description"
                md = item.get("markdown") or ""
                
                if len(md) > 2000:
                    md = md[:2000] + "..."
                
                # Formatujemy każdy wynik jako osobny blok tekstu
                text_block = f"Title: {title}
URL: {link}
Description: {desc}

Content:
{md}"
                content_list.append(types.TextContent(type="text", text=text_block))
                
            return content_list

        except Exception as e:
            return [types.TextContent(type="text", text=f"SDK Exception: {str(e)}")]

@mcp.tool()
async def firecrawl_scrape(url: str) -> str:
    """Scrape a URL."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                f"{API_URL}/v1/scrape",
                headers={"Authorization": f"Bearer {API_KEY}"},
                json={"url": url, "formats": ["markdown"]}
            )
            data = response.json()
            return data.get("data", {}).get("markdown", "No content")
        except Exception as e:
            return f"Error: {e}"

if __name__ == "__main__":
    mcp.settings.port = PORT
    mcp.settings.host = "0.0.0.0" 
    mcp.run(transport="sse")
