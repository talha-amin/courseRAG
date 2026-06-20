-- Enable pgvector extension at database init time so TypeORM can use the
-- vector() column type without a separate migration step.
CREATE EXTENSION IF NOT EXISTS vector;

-- Once TypeORM has synchronized the schema (creating chunks.embedding as TEXT)
-- the runtime ALTER below converts it to a true vector(1536) column. We guard
-- with a DO block so the migration is idempotent across restarts.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chunks' AND column_name = 'embedding' AND data_type = 'text'
  ) THEN
    EXECUTE 'ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(1536) USING embedding::vector';
  END IF;
END$$;
