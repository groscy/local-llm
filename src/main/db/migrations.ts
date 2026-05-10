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
  },
  {
    version: 11,
    sql: `
      CREATE TABLE IF NOT EXISTS learning_events (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        domain_id TEXT,
        actor TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        interaction_type TEXT NOT NULL,
        payload_ref TEXT NOT NULL,
        privacy_level TEXT NOT NULL,
        summary TEXT NOT NULL,
        details_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_learning_events_time ON learning_events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_learning_events_domain ON learning_events(domain_id);

      CREATE TABLE IF NOT EXISTS evidence_cards (
        id TEXT PRIMARY KEY,
        domain_id TEXT,
        summary TEXT NOT NULL,
        supporting_event_ids_json TEXT NOT NULL,
        confidence REAL NOT NULL,
        novelty_score REAL NOT NULL,
        tags_json TEXT NOT NULL,
        provenance TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evidence_cards_status ON evidence_cards(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_evidence_cards_domain ON evidence_cards(domain_id);

      CREATE TABLE IF NOT EXISTS training_manifests (
        id TEXT PRIMARY KEY,
        domain_id TEXT,
        dataset_hash TEXT NOT NULL,
        filters_json TEXT NOT NULL,
        counts_json TEXT NOT NULL,
        model_base TEXT NOT NULL,
        run_params_json TEXT NOT NULL,
        preview_markdown TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_training_manifests_domain ON training_manifests(domain_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS domain_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        terminology_json TEXT NOT NULL,
        objective TEXT NOT NULL,
        allowed_sources_json TEXT NOT NULL,
        retention_days INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS domain_model_versions (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL,
        train_job_id TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        quality_summary TEXT NOT NULL,
        regression_risk TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_domain_model_versions_domain ON domain_model_versions(domain_id, created_at DESC);
    `
  },
  {
    version: 12,
    sql: `
      ALTER TABLE train_jobs ADD COLUMN domain_id TEXT;
      ALTER TABLE train_jobs ADD COLUMN quality_summary TEXT;
      ALTER TABLE train_jobs ADD COLUMN regression_risk TEXT;
      ALTER TABLE train_jobs ADD COLUMN manifest_id TEXT;
    `
  },
  {
    version: 13,
    sql: `
      CREATE TABLE IF NOT EXISTS codebase_analysis_runs (
        id TEXT PRIMARY KEY,
        codebase_id TEXT NOT NULL,
        root_path TEXT NOT NULL,
        git_url TEXT,
        kb_source_id TEXT,
        summary_markdown TEXT NOT NULL,
        domain_model_json TEXT NOT NULL,
        design_patterns_json TEXT NOT NULL,
        architecture_patterns_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_codebase_analysis_runs_codebase_created
        ON codebase_analysis_runs(codebase_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_codebase_analysis_runs_kb_source
        ON codebase_analysis_runs(kb_source_id);
    `
  },
  {
    version: 14,
    sql: `
      CREATE TABLE IF NOT EXISTS codebase_analysis_sources (
        run_id TEXT NOT NULL,
        facet TEXT NOT NULL,
        source_id TEXT NOT NULL,
        PRIMARY KEY (run_id, facet),
        FOREIGN KEY (run_id) REFERENCES codebase_analysis_runs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_codebase_analysis_sources_source
        ON codebase_analysis_sources(source_id);
    `
  },
  {
    version: 15,
    sql: `
      CREATE TABLE IF NOT EXISTS wiki_entries (
        id TEXT PRIMARY KEY,
        canonical_keyword TEXT NOT NULL UNIQUE,
        active_revision_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_entries_keyword ON wiki_entries(canonical_keyword);

      CREATE TABLE IF NOT EXISTS wiki_entry_revisions (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        version_no INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        model_id TEXT,
        prompt_version TEXT,
        source_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES wiki_entries(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_entry_revisions_entry_version
        ON wiki_entry_revisions(entry_id, version_no);
      CREATE INDEX IF NOT EXISTS idx_wiki_entry_revisions_entry_created
        ON wiki_entry_revisions(entry_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS wiki_entry_sources (
        entry_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        PRIMARY KEY (entry_id, source_id),
        UNIQUE (source_id),
        FOREIGN KEY (entry_id) REFERENCES wiki_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (source_id) REFERENCES kb_sources(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_entry_sources_source ON wiki_entry_sources(source_id);

      CREATE TABLE IF NOT EXISTS wiki_keyword_relations (
        id TEXT PRIMARY KEY,
        from_entry_id TEXT NOT NULL,
        to_entry_id TEXT,
        to_keyword TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        confidence REAL NOT NULL,
        source_revision_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (from_entry_id) REFERENCES wiki_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (to_entry_id) REFERENCES wiki_entries(id) ON DELETE SET NULL,
        FOREIGN KEY (source_revision_id) REFERENCES wiki_entry_revisions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_keyword_rel_from ON wiki_keyword_relations(from_entry_id);
      CREATE INDEX IF NOT EXISTS idx_wiki_keyword_rel_to_entry ON wiki_keyword_relations(to_entry_id);
      CREATE INDEX IF NOT EXISTS idx_wiki_keyword_rel_to_keyword ON wiki_keyword_relations(to_keyword);
    `
  },
  {
    version: 16,
    sql: `
      CREATE TABLE IF NOT EXISTS dms_connections (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        display_name TEXT NOT NULL,
        account_email TEXT,
        tenant_id TEXT,
        site_id TEXT,
        token_ref TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'connected',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_synced_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_dms_connections_updated
        ON dms_connections(updated_at DESC);

      CREATE TABLE IF NOT EXISTS dms_import_roots (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        external_folder_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        external_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_synced_at INTEGER,
        FOREIGN KEY (connection_id) REFERENCES dms_connections(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_dms_import_roots_conn_folder
        ON dms_import_roots(connection_id, external_folder_id);
      CREATE INDEX IF NOT EXISTS idx_dms_import_roots_updated
        ON dms_import_roots(updated_at DESC);

      CREATE TABLE IF NOT EXISTS dms_import_items (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL,
        external_file_id TEXT NOT NULL,
        external_path TEXT NOT NULL,
        etag TEXT,
        mime_type TEXT,
        kb_source_id TEXT,
        last_seen_at INTEGER NOT NULL,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (root_id) REFERENCES dms_import_roots(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_dms_import_items_root_file
        ON dms_import_items(root_id, external_file_id);
      CREATE INDEX IF NOT EXISTS idx_dms_import_items_state
        ON dms_import_items(root_id, state);

      CREATE TABLE IF NOT EXISTS dms_sync_runs (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        status TEXT NOT NULL,
        imported_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        removed_count INTEGER NOT NULL DEFAULT 0,
        error_text TEXT,
        artifacts_json TEXT,
        FOREIGN KEY (root_id) REFERENCES dms_import_roots(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_dms_sync_runs_root_started
        ON dms_sync_runs(root_id, started_at DESC);
    `
  },
  {
    version: 17,
    sql: `
      CREATE TABLE IF NOT EXISTS ontology_entities (
        id TEXT PRIMARY KEY,
        iri TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ontology_entities_type ON ontology_entities(type);
      CREATE INDEX IF NOT EXISTS idx_ontology_entities_label ON ontology_entities(label);

      CREATE TABLE IF NOT EXISTS ontology_triples (
        id TEXT PRIMARY KEY,
        subject_iri TEXT NOT NULL,
        predicate_iri TEXT NOT NULL,
        object_iri TEXT,
        object_literal TEXT,
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ontology_triples_subject ON ontology_triples(subject_iri);
      CREATE INDEX IF NOT EXISTS idx_ontology_triples_predicate ON ontology_triples(predicate_iri);
      CREATE INDEX IF NOT EXISTS idx_ontology_triples_object ON ontology_triples(object_iri);
      CREATE INDEX IF NOT EXISTS idx_ontology_triples_source_ref ON ontology_triples(source_ref);
      CREATE INDEX IF NOT EXISTS idx_ontology_triples_created ON ontology_triples(created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ontology_triples_unique_fact
        ON ontology_triples(subject_iri, predicate_iri, COALESCE(object_iri, ''), COALESCE(object_literal, ''), source_ref);

      CREATE TABLE IF NOT EXISTS ontology_namespaces (
        prefix TEXT PRIMARY KEY,
        base_iri TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ontology_snapshots (
        id TEXT PRIMARY KEY,
        summary_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ontology_snapshots_created ON ontology_snapshots(created_at DESC);
    `
  },
  {
    version: 18,
    sql: `
      ALTER TABLE kb_chunks ADD COLUMN anchor TEXT;
      ALTER TABLE kb_chunks ADD COLUMN passage_title TEXT;
      CREATE INDEX IF NOT EXISTS idx_kb_chunks_source_ord ON kb_chunks(source_id, ord);
      CREATE INDEX IF NOT EXISTS idx_kb_chunks_anchor ON kb_chunks(anchor);
    `
  },
  {
    version: 19,
    sql: `
      CREATE TABLE IF NOT EXISTS kb_documents (
        source_id TEXT PRIMARY KEY,
        raw_text TEXT NOT NULL,
        distilled_body TEXT NOT NULL,
        confidence_score REAL NOT NULL DEFAULT 0.5,
        confidence_reasons_json TEXT NOT NULL DEFAULT '[]',
        diagnostics_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (source_id) REFERENCES kb_sources(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_kb_documents_confidence ON kb_documents(confidence_score);
    `
  },
  {
    version: 20,
    sql: `
      CREATE TABLE IF NOT EXISTS kb_ingest_jobs (
        id TEXT PRIMARY KEY,
        source_id TEXT,
        file_path TEXT NOT NULL,
        title TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_ingest_jobs_updated ON kb_ingest_jobs(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_kb_ingest_jobs_status ON kb_ingest_jobs(status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS kb_document_sections (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        heading TEXT,
        body TEXT NOT NULL,
        page_start INTEGER,
        page_end INTEGER,
        anchor TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (source_id) REFERENCES kb_sources(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_kb_document_sections_source_ord ON kb_document_sections(source_id, ord);

      CREATE TABLE IF NOT EXISTS kb_chunk_embeddings (
        chunk_id TEXT PRIMARY KEY,
        vector_json TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES kb_chunks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS kb_entity_mentions (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        chunk_id TEXT,
        entity TEXT NOT NULL,
        entity_kind TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (source_id) REFERENCES kb_sources(id) ON DELETE CASCADE,
        FOREIGN KEY (chunk_id) REFERENCES kb_chunks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_kb_entity_mentions_source ON kb_entity_mentions(source_id);
      CREATE INDEX IF NOT EXISTS idx_kb_entity_mentions_entity ON kb_entity_mentions(entity);

      CREATE TABLE IF NOT EXISTS kb_doc_relations (
        id TEXT PRIMARY KEY,
        from_source_id TEXT NOT NULL,
        to_source_id TEXT NOT NULL,
        relation_kind TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (from_source_id) REFERENCES kb_sources(id) ON DELETE CASCADE,
        FOREIGN KEY (to_source_id) REFERENCES kb_sources(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_doc_rel_unique ON kb_doc_relations(from_source_id, to_source_id, relation_kind);
      CREATE INDEX IF NOT EXISTS idx_kb_doc_rel_conf ON kb_doc_relations(confidence DESC);

      CREATE TABLE IF NOT EXISTS kb_domains (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0.5,
        centroid_terms_json TEXT NOT NULL DEFAULT '[]',
        source_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_domains_updated ON kb_domains(updated_at DESC);

      CREATE TABLE IF NOT EXISTS kb_domain_membership (
        source_id TEXT NOT NULL,
        domain_id TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        rationale TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, domain_id),
        FOREIGN KEY (source_id) REFERENCES kb_sources(id) ON DELETE CASCADE,
        FOREIGN KEY (domain_id) REFERENCES kb_domains(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_kb_domain_membership_domain ON kb_domain_membership(domain_id, confidence DESC);

      CREATE TABLE IF NOT EXISTS kb_domain_retrieval_units (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source_ids_json TEXT NOT NULL DEFAULT '[]',
        chunk_ids_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (domain_id) REFERENCES kb_domains(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_kb_domain_retrieval_units_domain ON kb_domain_retrieval_units(domain_id, updated_at DESC);
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
