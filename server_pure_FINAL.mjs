import { FastMCP } from 'firecrawl-fastmcp';
import FirecrawlApp from '@mendable/firecrawl-js';
import { z } from 'zod';

const API_URL = 'http://127.0.0.1:3006';
const PORT = 3008;

console.log(`[Pure SDK] Initializing with API: ${API_URL}`);

const app = new FirecrawlApp({
    apiUrl: API_URL,
    apiKey: 'fc-selfhosted'
});

const server = new FastMCP({
    name: 'firecrawl-pure',
    version: '2.0.6',
});

server.addTool({
    name: 'firecrawl_search',
    description: 'Search using Firecrawl SDK (Pure).',
    parameters: z.object({
        query: z.string(),
        limit: z.number().optional().default(5),
        scrapeOptions: z.any().optional()
    }),
    execute: async (args) => {
        console.log(`[Pure SDK] Searching: ${args.query}`);
        try {
            const response = await app.search(args.query, {
                limit: args.limit,
                scrapeOptions: args.scrapeOptions || { formats: ['markdown'] }
            });

            if (!response.success) {
                return JSON.stringify({ error: response.error });
            }
            
            // Proste zwracanie JSONa, Kimi sobie z tym poradzi
            return JSON.stringify(response.data, null, 2);
        } catch (error) {
            console.error("[Pure SDK] Error:", error.message);
            return JSON.stringify({ error: error.message });
        }
    }
});

server.addTool({
    name: 'firecrawl_scrape',
    description: 'Scrape a URL using Firecrawl SDK.',
    parameters: z.object({
        url: z.string(),
        formats: z.array(z.string()).optional().default(['markdown'])
    }),
    execute: async (args) => {
        console.log(`[Pure SDK] Scraping: ${args.url}`);
        try {
            const response = await app.scrapeUrl(args.url, {
                formats: args.formats
            });
            return JSON.stringify(response, null, 2);
        } catch (error) {
            return JSON.stringify({ error: error.message });
        }
    }
});

console.log(`Starting Pure Firecrawl MCP on port ${PORT}...`);
server.start({
    transportType: 'httpStream',
    httpStream: {
        port: PORT,
        host: '127.0.0.1',
    }
});
