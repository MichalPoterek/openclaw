CREATE EXTENSION IF NOT EXISTS vector;

-- Paired before/after compression snapshots
CREATE TABLE context_snapshots (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),

  -- BEFORE compression (original context)
  original_message_count INT NOT NULL,
  original_token_estimate INT NOT NULL,
  original_context JSONB NOT NULL,

  -- AFTER compression (10/60/30 structured output)
  compressed_token_estimate INT,
  compressed_context JSONB,
  compression_ratio REAL,
  compression_latency_ms INT,

  -- Metadata
  model_used TEXT,
  trigger_reason TEXT,
  embedding vector(768),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_snapshots_session ON context_snapshots(session_id);
CREATE INDEX idx_snapshots_time ON context_snapshots(timestamp DESC);
CREATE INDEX idx_snapshots_ratio ON context_snapshots(compression_ratio);
CREATE INDEX idx_snapshots_embedding ON context_snapshots
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

-- Compression quality feedback (did compressed context lead to good model response?)
CREATE TABLE compression_quality (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT REFERENCES context_snapshots(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  model_response_success BOOLEAN,
  model_response_tokens INT,
  had_tool_calls BOOLEAN,
  error_occurred BOOLEAN DEFAULT FALSE,
  response_latency_ms INT,
  notes TEXT
);

CREATE INDEX idx_quality_snapshot ON compression_quality(snapshot_id);

-- Operation timing log (for monitoring all subsystem performance)
CREATE TABLE operation_log (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  operation TEXT NOT NULL,
  duration_ms INT NOT NULL,
  success BOOLEAN DEFAULT TRUE,
  input_size INT,
  output_size INT,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_oplog_time ON operation_log(timestamp DESC);
CREATE INDEX idx_oplog_operation ON operation_log(operation);

-- Auto-cleanup: keep last 200 snapshots per session
CREATE OR REPLACE FUNCTION cleanup_old_snapshots() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM context_snapshots
  WHERE id IN (
    SELECT id FROM context_snapshots
    WHERE session_id = NEW.session_id
    ORDER BY timestamp DESC
    OFFSET 200
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cleanup_snapshots
  AFTER INSERT ON context_snapshots
  FOR EACH ROW EXECUTE FUNCTION cleanup_old_snapshots();

-- Auto-cleanup operation_log: keep last 7 days
CREATE OR REPLACE FUNCTION cleanup_old_operations() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM operation_log WHERE timestamp < NOW() - INTERVAL '7 days';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cleanup_operations
  AFTER INSERT ON operation_log
  FOR EACH ROW EXECUTE FUNCTION cleanup_old_operations();
