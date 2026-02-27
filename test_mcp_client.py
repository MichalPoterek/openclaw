import asyncio
from mcp.client.stdio import StdioServerParameters
from mcp.client.sse import sse_client
from mcp import ClientSession

async def run():
    print("Connecting to MCP Server at http://localhost:3008/sse...")
    async with sse_client("http://localhost:3008/sse") as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            
            print("
--- Listing Tools ---")
            tools = await session.list_tools()
            for tool in tools.tools:
                print(f"- {tool.name}: {tool.description}")
            
            print("
--- Testing firecrawl_search ---")
            try:
                result = await session.call_tool("firecrawl_search", arguments={"query": "test"})
                print("Result:")
                # MCP returns a list of content objects
                for content in result.content:
                    print(content.text[:500] + "...") # Print first 500 chars
            except Exception as e:
                print(f"Error calling tool: {e}")

if __name__ == "__main__":
    asyncio.run(run())
