# CourseRAG

![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-15%20+%20pgvector-336791?logo=postgresql&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-text--embedding--3--small-412991?logo=openai&logoColor=white)
![Anthropic](https://img.shields.io/badge/Claude-sonnet--4--6-D77655?logo=anthropic&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

A production-quality **Retrieval-Augmented Generation** API that turns a student's PDF course materials into a grounded Q&A system. Upload a lecture PDF, ask a question, and get a cited answer that the model cannot fabricate — every claim is fact-checked against the retrieved source passages before being returned.

The point of this project isn't just to do RAG — it's to do it _honestly_. A second LLM pass acts as an adversarial fact-checker that scores how grounded the answer is, surfaces unsupported claims, and returns a confidence number alongside every response. If the relevant material isn't in the document, the API refuses to answer rather than hallucinating from the model's prior knowledge.

---

## Architecture

```
                       ┌─────────────────────── INGESTION ───────────────────────┐
                       │                                                         │
   PDF upload ──► pdf-parse ──► ChunkingService ──► EmbeddingsService ──► pgvector
                       │       (~500 token chunks    (OpenAI                     │
                       │        with 50 token         text-embedding-3-small,    │
                       │        overlap, paragraph    1536 dims)                 │
                       │        + sentence aware)                                │
                       └─────────────────────────────────────────────────────────┘

                       ┌─────────────────────── RETRIEVAL ───────────────────────┐
                       │                                                         │
   Question ──► EmbeddingsService ──► pgvector cosine ──► Claude (grounded) ──► Claude (fact-check)
                                       similarity            │                       │
                                       (top-K chunks)        │                       ▼
                                                             │              { isGrounded,
                                                             ▼                confidence,
                                                       Cited answer:           unsupportedClaims,
                                                       "...[Chunk 3, Page 7]"  reasoning }
                       └─────────────────────────────────────────────────────────┘
```

| Layer       | Tech                                                    |
| ----------- | ------------------------------------------------------- |
| API         | NestJS 10 (modular, DI, strict TypeScript)              |
| Storage     | PostgreSQL 15 + [pgvector](https://github.com/pgvector/pgvector) |
| Embeddings  | OpenAI `text-embedding-3-small` (1536 dim)              |
| LLM         | Anthropic Claude `claude-sonnet-4-6`                    |
| PDF parsing | `pdf-parse`                                             |
| Validation  | `class-validator` DTOs + global `ValidationPipe`        |
| Docs        | Auto-generated Swagger at `GET /api/docs`               |
| Tests       | Jest + Supertest (45+ unit tests, all external APIs mocked) |

---

## Quick Start

### 1. Clone and configure

```bash
git clone <repo> courserag
cd courserag
cp .env.example .env
# edit .env: set OPENAI_API_KEY and ANTHROPIC_API_KEY
```

### 2. Spin up Postgres + the API

```bash
docker compose up --build
```

The API will be available at:

- **API**: http://localhost:3000
- **Swagger docs**: http://localhost:3000/api/docs
- **Health**: http://localhost:3000/health

### 3. Upload a course PDF

```bash
curl -X POST http://localhost:3000/documents/upload \
  -F "file=@lecture-notes.pdf"
```

Response:

```json
{
  "documentId": "7f8d12a4-aaaa-bbbb-cccc-1234567890ab",
  "filename": "1718905200000_lecture-notes.pdf",
  "pageCount": 12,
  "chunkCount": 47,
  "processingTimeMs": 3420
}
```

### 4. Ask a grounded question

```bash
curl -X POST http://localhost:3000/questions/ask \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "7f8d12a4-aaaa-bbbb-cccc-1234567890ab",
    "question": "What is the difference between supervised and unsupervised learning?",
    "topK": 5
  }'
```

Response:

```json
{
  "answer": "Supervised learning uses labelled training data to learn a mapping from inputs to outputs, whereas unsupervised learning finds structure in unlabelled data such as clusters or low-dimensional representations. [Chunk 3, Page 7]",
  "isGrounded": true,
  "groundingConfidence": 0.94,
  "unsupportedClaims": [],
  "groundingReasoning": "All claims directly reference retrieved passages.",
  "sourcesUsed": [
    {
      "chunkIndex": 3,
      "pageNumber": 7,
      "contentPreview": "Supervised learning is defined as the task of learning a function..."
    }
  ],
  "retrievedChunkCount": 5,
  "processingTimeMs": 1840
}
```

---

## API Endpoints

| Method | Path                              | Purpose                                     |
| ------ | --------------------------------- | ------------------------------------------- |
| POST   | `/documents/upload`               | Upload + ingest a PDF (multipart/form-data) |
| GET    | `/documents`                      | List all uploaded documents                 |
| GET    | `/documents/:id`                  | Fetch a single document's metadata          |
| DELETE | `/documents/:id`                  | Delete a document and all its chunks        |
| POST   | `/questions/ask`                  | Ask a grounded question                     |
| GET    | `/questions/history/:documentId`  | Last 20 Q&A pairs for a document            |
| GET    | `/health`                         | Liveness + DB readiness                     |
| GET    | `/api/docs`                       | Swagger / OpenAPI explorer                  |

### List documents

```bash
curl http://localhost:3000/documents
```

### Fetch one document

```bash
curl http://localhost:3000/documents/7f8d12a4-aaaa-bbbb-cccc-1234567890ab
```

### Delete

```bash
curl -X DELETE http://localhost:3000/documents/7f8d12a4-aaaa-bbbb-cccc-1234567890ab
```

### Q&A history

```bash
curl http://localhost:3000/questions/history/7f8d12a4-aaaa-bbbb-cccc-1234567890ab
```

---

## How the chunking strategy works

PDF text doesn't come pre-segmented by meaning, so chunking is the single biggest knob in any RAG pipeline. CourseRAG uses a **three-tier cascading splitter**:

1. **Paragraph-first.** Text is split on blank lines (`\n\n`). Most academic prose is organized into paragraphs that already correspond to a coherent unit of thought — keeping them intact preserves the most context per chunk.
2. **Sentence-boundary fallback.** If a paragraph exceeds the ~500 token target, it is split at sentence terminators (`.!?`), greedily grouping sentences into chunks just under the target. This avoids cutting a definition or argument mid-sentence.
3. **Hard split as last resort.** A single run-on sentence longer than 500 tokens is hard-split on word boundaries. This is rare in academic text but the safety valve guarantees chunk size stays bounded.

**Overlap.** Each chunk (except the first) is prefixed with ~50 tokens of trailing context from the previous chunk. This is critical for retrieval recall: a question about "the second property" may match a chunk whose chunk-1 context was the list intro that defined what "property" means. Without overlap, the model loses the antecedent.

**Filtering.** Chunks under 50 characters (page numbers, headers, stray footers) are dropped. They embed poorly and pollute the top-K with noise.

**Page estimation.** Since `pdf-parse` returns the full text as one string, page numbers are estimated proportionally from each chunk's character offset against the total character count and known page count. It's an approximation, but the resulting citation (`[Chunk 3, Page 7]`) is accurate to within a page on real lectures.

Token counts use a simple `words × 1.3` heuristic — close enough to a real tokenizer for chunking, and avoids pulling in a multi-megabyte tokenizer dependency.

---

## How the hallucination detection layer works

The most common failure mode of RAG isn't retrieval — it's the generator confidently extending a partial answer with prior-knowledge filler when the retrieved passages don't quite cover the question. CourseRAG mitigates that with a **two-pass design**:

**Pass 1 — Grounded generation.** The retrieved top-K chunks are sent to Claude with a strict system prompt: answer using _only_ these passages, cite them in `[Chunk N, Page P]` format, and refuse with a fixed sentinel string if the answer isn't present. Outside knowledge is forbidden.

**Pass 2 — Adversarial fact-check.** The same retrieved chunks _and_ Claude's answer are sent back to a second Claude call playing the role of a fact-checker. It returns strict JSON:

```json
{
  "isGrounded": true,
  "confidence": 0.94,
  "unsupportedClaims": [],
  "reasoning": "All claims directly reference retrieved passages."
}
```

`confidence` is clamped to `[0, 1]`. `unsupportedClaims` enumerates the specific atomic claims (if any) the checker thinks aren't supported by the passages. `isGrounded = false` with a non-empty `unsupportedClaims` list is the canonical hallucination signal — UI clients can flag, suppress, or re-route the answer to a human.

The parser is defensive against the usual LLM-formatted-output failure modes: markdown code fences are stripped, surrounding prose is trimmed to the outermost `{...}`, malformed JSON falls back to a safe `{ isGrounded: false, confidence: 0 }` rather than crashing the request.

If retrieval returns zero chunks (e.g. the question is off-topic for the uploaded document), the service short-circuits with the canonical refusal _without_ calling Claude at all — saving a round-trip and avoiding any opportunity for hallucination.

---

## Project structure

```
src/
├── main.ts                       # bootstrap + Swagger
├── app.module.ts                 # composes feature modules + TypeORM
├── common/
│   └── filters/                  # global exception filter
├── config/
│   └── env.validation.ts         # class-validator env schema
├── embeddings/
│   └── embeddings.service.ts     # OpenAI client + batching + retry
├── documents/
│   ├── documents.controller.ts   # upload + CRUD
│   ├── documents.service.ts      # ingestion orchestrator
│   ├── chunking.service.ts       # paragraph/sentence/hard split
│   ├── pdf-parser.service.ts     # pdf-parse wrapper
│   └── entities/                 # Document, Chunk
├── questions/
│   ├── questions.controller.ts   # ask + history
│   ├── questions.service.ts      # retrieve → ground → fact-check pipeline
│   ├── retrieval.service.ts      # pgvector top-K cosine search
│   ├── claude.service.ts         # Anthropic client + JSON-safe parsing
│   └── entities/                 # Question
└── health/
    └── health.controller.ts      # /health + DB ping
```

---

## Development

### Install dependencies and run locally

```bash
npm install
npm run start:dev          # watch mode on http://localhost:3000
```

### Tests

```bash
npm test                   # 45+ unit tests, all external APIs mocked
npm run test:cov           # with coverage
```

### Lint / format

```bash
npm run lint
npm run format
```

---

## Environment variables

| Variable                  | Default                       | Purpose                                       |
| ------------------------- | ----------------------------- | --------------------------------------------- |
| `PORT`                    | `3000`                        | HTTP port                                     |
| `DATABASE_URL`            | _required_                    | Postgres connection string                    |
| `DATABASE_SSL`            | `false`                       | Set `true` for hosted Postgres (e.g. Supabase) |
| `OPENAI_API_KEY`          | _required_                    | OpenAI key for embeddings                     |
| `OPENAI_EMBEDDING_MODEL`  | `text-embedding-3-small`      | Embedding model id                            |
| `ANTHROPIC_API_KEY`       | _required_                    | Anthropic key for Claude                      |
| `ANTHROPIC_MODEL`         | `claude-sonnet-4-6`           | Claude model id                               |
| `MAX_FILE_SIZE_MB`        | `10`                          | Multer upload limit                           |
| `DEFAULT_TOP_K`           | `5`                           | Retrieval breadth when `topK` is omitted      |
| `CHUNK_TARGET_TOKENS`     | `500`                         | Chunker target size                           |
| `CHUNK_OVERLAP_TOKENS`    | `50`                          | Chunker overlap window                        |

---

## Error responses

All errors flow through a global exception filter and return a uniform shape:

```json
{
  "statusCode": 413,
  "timestamp": "2026-06-20T14:32:11.123Z",
  "path": "/documents/upload",
  "method": "POST",
  "message": "File exceeds maximum size of 10MB"
}
```

| Status | Cause                                            |
| ------ | ------------------------------------------------ |
| 400    | Validation error / non-PDF upload / missing file |
| 404    | Document not found                               |
| 413    | File exceeds `MAX_FILE_SIZE_MB`                  |
| 422    | PDF contains no extractable text                 |
| 502    | OpenAI or Claude upstream failure (retryable)    |

---

## License

MIT.
