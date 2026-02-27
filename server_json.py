from mcp.server.fastmcp import FastMCP
import httpx
import json
import os

API_URL = "http://127.0.0.1:3006"
PORT = 3008
API_KEY = "fc-selfhosted"

mcp = FastMCP("firecrawl-python")

@mcp.tool()
async def firecrawl_search(query: str, limit: int = 5) -> str:
    """Search using Firecrawl SDK. Returns JSON string list."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                f"{API_URL}/v1/search",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"},
                json={"query": query, "limit": limit, "scrapeOptions": {"formats": ["markdown"]}}
            )
            
            data = response.json()
            if not data.get("success"):
                return json.dumps({"error": data.get("error")})
                
            # Zwracamy czysty JSON, Agent Zero sobie to sparsuje
            return json.dumps(data.get("data", []), indent=2)

        except Exception as e:
            return json.dumps({"error": str(e)})

if __name__ == "__main__":
    mcp.settings.port = PORT
    mcp.settings.host = "0.0.0.0" 
    mcp.run(transport="sse")
