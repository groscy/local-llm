import type Database from 'better-sqlite3'

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS hf_model_cache (
        repo_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        local_path TEXT NOT NULL,
        status TEXT NOT NULL,
        bytes_total INTEGER DEFAULT 0,
        verified INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

      CREATE TABLE IF NOT EXISTS kb_sources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        uri TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kb_chunks (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        heading TEXT,
        text TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES kb_sources(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_kb_chunks_source ON kb_chunks(source_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(chunk_id UNINDEXED, body);

      CREATE TRIGGER IF NOT EXISTS kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN
        INSERT INTO kb_chunks_fts(chunk_id, body) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN
        DELETE FROM kb_chunks_fts WHERE chunk_id = old.id;
      END;
      CREATE TRIGGER IF NOT EXISTS kb_chunks_au AFTER UPDATE ON kb_chunks BEGIN
        DELETE FROM kb_chunks_fts WHERE chunk_id = old.id;
        INSERT INTO kb_chunks_fts(chunk_id, body) VALUES (new.id, new.text);
      END;

      CREATE TABLE IF NOT EXISTS wiki_pages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wiki_page_chunks (
        page_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        PRIMARY KEY (page_id, chunk_id)
      );

      CREATE TABLE IF NOT EXISTS metrics_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        runtime_tokens_per_sec REAL,
        runtime_ctx_used INTEGER,
        process_cpu_percent REAL,
        process_rss_mb REAL,
        gpu_mem_used_mb REAL,
        gpu_mem_total_mb REAL
      );

      CREATE TABLE IF NOT EXISTS train_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        base_model_path TEXT NOT NULL,
        output_dir TEXT NOT NULL,
        message TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        created_at INTEGER NOT NULL
      );
    `
  },
  {
    version: 2,
    sql: `
      ALTER TABLE kb_sources ADD COLUMN conversation_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_kb_sources_conversation_id ON kb_sources(conversation_id);
    `
  },
  {
    version: 3,
    sql: `
      ALTER TABLE metrics_samples ADD COLUMN model_memory_mb REAL;
    `
  },
  {
    version: 4,
    sql: `
      ALTER TABLE downloads ADD COLUMN chat_display_name TEXT;
    `
  },
  {
    version: 5,
    sql: `
      ALTER TABLE messages ADD COLUMN prompt_tokens INTEGER;
      ALTER TABLE messages ADD COLUMN completion_tokens INTEGER;
      ALTER TABLE messages ADD COLUMN prompt_tokens_estimated INTEGER;
      ALTER TABLE messages ADD COLUMN completion_tokens_estimated INTEGER;
    `
  },
  {
    version: 6,
    sql: `
      ALTER TABLE metrics_samples ADD COLUMN avg_prompt_to_response_ms REAL;
    `
  },
  {
    version: 7,
    sql: `
      ALTER TABLE downloads ADD COLUMN hf_filename TEXT;
    `
  },
  {
    version: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS prompt_domains (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        keywords_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_domains_updated ON prompt_domains(updated_at);

      CREATE TABLE IF NOT EXISTS message_prompt_domains (
        message_id TEXT NOT NULL,
        domain_id TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (message_id, domain_id),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (domain_id) REFERENCES prompt_domains(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_message_prompt_domains_domain ON message_prompt_domains(domain_id);
    `
  },
  {
    version: 9,
    sql: `
      ALTER TABLE train_jobs ADD COLUMN kb_source_ids_json TEXT;
      ALTER TABLE train_jobs ADD COLUMN display_name TEXT;
      ALTER TABLE train_jobs ADD COLUMN dataset_path TEXT;
      ALTER TABLE train_jobs ADD COLUMN artifact_path TEXT;
    `
  },
  {
    version: 10,
    sql: `
      ALTER TABLE prompt_domains ADD COLUMN system_suffix TEXT;
    `
  }
]

export function migrate(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  let current = Number(db.pragma('user_version', { simple: true }))
  if (Number.isNaN(current)) current = 0
  for (const m of MIGRATIONS) {
    if (current < m.version) {
      db.exec(m.sql)
      db.pragma(`user_version = ${m.version}`)
      current = m.version
    }
  }
}
