from mcp.server.fastmcp import FastMCP
import httpx
import logging

# Konfiguracja logowania
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

API_URL = "http://127.0.0.1:3006"
PORT = 3008
API_KEY = "fc-selfhosted"

mcp = FastMCP("firecrawl-python")

@mcp.tool()
async def firecrawl_search(query: str, limit: int = 5) -> str:
    """Search using Firecrawl SDK. Returns SIMPLE TEXT."""
    logger.info(f"Searching: {query}")
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                f"{API_URL}/v1/search",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"},
                json={"query": query, "limit": limit, "scrapeOptions": {"formats": ["markdown"]}}
            )
            
            data = response.json()
            if not data.get("success"):
                return f"Error: {data.get('error')}"
                
            results = data.get("data", [])
            logger.info(f"Got {len(results)} results")
            
            output = []
            for i, item in enumerate(results):
                title = item.get("title", "No Title")
                url = item.get("url", "#")
                # Bardzo prosty format, aby wykluczyć problemy z Markdown
                entry = f"Result {i+1}: {title} ({url})"
                output.append(entry)
                
            final_text = "

".join(output)
            logger.info(f"Returning text length: {len(final_text)}")
            return final_text

        except Exception as e:
            logger.error(f"Error: {e}")
            return f"Exception: {str(e)}"

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
