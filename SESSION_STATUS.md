# Epstein Platform - Session Status
**Date:** 2026-02-13 (Session ended ~21:15 CET)

## What Was Done This Session

### Downloads Completed
1. **DOJ Datasets 9, 10, 11** - Torrents, extracted, media uploaded to S3, imported to PostgreSQL
2. **Internet Archive full collection** (USAvJeffreyEpstein) - 65 GB, 80 ZIPs
3. **House Oversight Google Drive** - 76 GB (41 IMAGES ZIPs + DATA/NATIVES/TEXT ZIPs + Giuffre PDF)
4. **Internet Archive OCR collection** (epstein-pdf) - 13 GB, 67K OCR'd PDFs
5. **House Oversight estate-first** - Dropbox ZIP
6. **FBI Vault FOIA** - 44 files, 78 MB
7. **Filthy Rich.pdf** - Book, 280 pages

### Processing Completed
1. **Text extraction fix** - Fixed null byte PostgreSQL error + infinite retry loop
2. **Text extraction** - 16 parallel workers extracted ~29K documents (97% success)
3. **GDrive processing** - 22,640 images ingested with pre-extracted text from TEXT ZIP, uploaded to S3
4. **IA OCR ingestion** - 33,572 files via process_all_downloads.py
5. **Media file import** - 861 media files (videos/audio) from DS10/DS11
6. **nginx body size limit** - Increased from 20M to 200M

### Scripts Created/Modified
- `processing/extract_court_records.py` - Removed source filter, fixed null bytes, fixed error handler
- `processing/process_all_downloads.py` - 5-phase server processing script
- `processing/process_gdrive_local.py` - GDrive ZIP processing with text matching

## Current State of All 4 Databases

### 1. PostgreSQL - Document Metadata & Text
| Status | Count |
|--------|-------|
| **completed** | 1,442,221 |
| **pending** | 20,208 |
| **needs_ocr** | 11,361 |
| **error** | 1,234 |
| **processing** | 188 |
| **TOTAL** | ~1,475,212 |

### 2. Hetzner S3 - File Storage
All 1,475,212 documents uploaded. Zero docs missing r2_key.

### 3. Qdrant - Vector Embeddings
- **91,768 points** / 1,442,221 completed = **6.2% coverage**
- Collection: `document_embeddings` (768d BGE-base-en-v1.5)
- `embed.py` running since Feb 06 but slow

### 4. Neo4j - Knowledge Graph
| Entity Type | Count |
|-------------|-------|
| Document | 566,608 (38.5% coverage) |
| Person | 216,579 |
| Organization | 127,581 |
| Location | 72,753 |

~876K documents still need entity extraction.

## Running Processes on Server
| Process | Status |
|---------|--------|
| `embed.py` | Running since Feb 06 (V1 BGE embeddings) |
| `cloudflare_ocr.py` | Running since Feb 07 (2 workers, continuous) |
| Docker containers (16) | All running (nginx unhealthy - needs check) |

No text extraction workers running - they completed and exited.

## Server Disk
- **Available:** 127 GB (66% used)
- **Cleanable:** 76 GB `house-oversight-gdrive/` (done, safe to delete) + 61 MB `_gdrive_extracted/`

## Pending Work

### 1. Process IA Full Collection ZIPs (65 GB, 80 ZIPs)
Location: `/opt/app/data/downloads/ia-full-collection/`
- Court Records (50 ZIPs, 5.2 GB), EFTA (8 ZIPs, 13 GB), EFTA Modified (7 ZIPs, 39 GB), FOIA (4 ZIPs, 7.5 GB)
- Need: extract → upload S3 → import PostgreSQL → text extraction
- Many will be duplicates of already-ingested files

### 2. OCR / Text Extraction (31,553 docs)
- 20,192 `house-oversight-gdrive` - JPG/TIF images, no text (need OCR)
- 10,652 `house-oversight-ocr` - OCR'd PDFs pdf-parse can't handle
- 709 `epstein-archive` - zero-size files

### 3. Qdrant Embeddings (93.8% remaining)
- 1,350,453 completed docs need embeddings generated
- `embed.py` running but very slow - needs scaling or V2 (OpenAI 1536d) migration

### 4. Neo4j Entity Extraction (61.5% remaining)
- ~876K documents need entity extraction (people, orgs, locations)
- Pipeline at `/opt/app/processing/entity-extractor/`

### 5. Clean Up Server Disk
- Delete processed `house-oversight-gdrive/` (76 GB)
- After IA processing, delete `ia-full-collection/` (65 GB)

### 6. Error Cleanup (1,234 docs)
- 840 `dataset_10`, 349 `efta-20251231-dataset-8`, 40 `house-oversight`
- Mostly "Invalid PDF structure" - genuinely problematic files
