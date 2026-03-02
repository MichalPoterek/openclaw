"""
Patch for OpenMemory config.py router (app/routers/config.py)

Adds openai_base_url field to LLMConfig and EmbedderConfig Pydantic models,
and embedding_dims to EmbedderConfig. This allows Mem0 to use OpenAI-compatible
endpoints (like Gemini Bridge or LM Studio) instead of direct OpenAI/Gemini APIs.

Apply: Copy the patched config.py to /home/mike/mem0/openmemory/api/app/routers/config.py
       The uvicorn --reload flag will auto-detect the change.

Then update config via API:
  # LLM (via Gemini Bridge)
  curl -X PUT http://127.0.0.1:8765/api/v1/config/mem0/llm \
    -H 'Content-Type: application/json' \
    -d '{"provider":"openai","config":{"model":"gemini-2.5-flash-lite","temperature":0.1,"max_tokens":2000,"api_key":"YOUR_KEY","openai_base_url":"http://host.docker.internal:3458/v1"}}'

  # Embedder (via LM Studio nomic-embed-text)
  curl -X PUT http://127.0.0.1:8765/api/v1/config/mem0/embedder \
    -H 'Content-Type: application/json' \
    -d '{"provider":"openai","config":{"model":"text-embedding-nomic-embed-text-v1.5@q8_0","api_key":"not-needed","openai_base_url":"http://172.16.0.118:1234/v1","embedding_dims":768}}'
"""

# Changes to LLMConfig class:
# + openai_base_url: Optional[str] = Field(None, description="Base URL for OpenAI-compatible server")

# Changes to EmbedderConfig class:
# + openai_base_url: Optional[str] = Field(None, description="Base URL for OpenAI-compatible embedding server")
# + embedding_dims: Optional[int] = Field(None, description="Embedding dimensions (e.g., 768 for nomic-embed-text)")
