#!/usr/bin/env node
// Sync missing DataSet_10 files to R2 and register in database
// Run: node sync-missing-files.js

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

// Configuration
const DATA_DIR = '/var/www/DataSet_10';
const BATCH_SIZE = 100;
const CONCURRENT_UPLOADS = 10;

// R2 client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

const R2_BUCKET = process.env.R2_BUCKET || 'epstein-documents';

// PostgreSQL connection
const pool = new Pool({
  host: process.env.PG_HOST || 'postgres',
  port: parseInt(process.env.PG_PORT || '5432'),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'epstein',
  max: 20,
});

// Get list of files already in database for dataset_10
async function getExistingFilenames() {
  const result = await pool.query(`
    SELECT filename FROM documents
    WHERE source = 'dataset_10' OR r2_key LIKE 'dataset_10/%'
  `);
  return new Set(result.rows.map(r => r.filename));
}

// Get all PDF files in DataSet_10 directory
function getLocalFiles() {
  const files = [];

  function walkDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
          files.push({
            path: fullPath,
            filename: entry.name,
          });
        }
      }
    } catch (err) {
      console.error(`Error reading directory ${dir}:`, err.message);
    }
  }

  walkDir(DATA_DIR);
  return files;
}

// Upload file to R2
async function uploadToR2(filePath, r2Key) {
  try {
    const fileContent = fs.readFileSync(filePath);

    await r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: fileContent,
      ContentType: 'application/pdf',
    }));

    return true;
  } catch (err) {
    console.error(`Upload error for ${r2Key}:`, err.message);
    return false;
  }
}

// Register document in database
async function registerDocument(filename, r2Key, fileSize) {
  try {
    await pool.query(`
      INSERT INTO documents (filename, r2_key, source, file_size, embedding_status, created_at)
      VALUES ($1, $2, 'dataset_10', $3, 'pending', NOW())
      ON CONFLICT (filename) DO UPDATE SET
        r2_key = EXCLUDED.r2_key,
        embedding_status = CASE
          WHEN documents.embedding_status = 'failed' THEN 'pending'
          ELSE documents.embedding_status
        END
    `, [filename, r2Key, fileSize]);
    return true;
  } catch (err) {
    console.error(`DB error for ${filename}:`, err.message);
    return false;
  }
}

// Process files in batches with concurrency
async function processFiles(files, existingFiles) {
  const missing = files.filter(f => !existingFiles.has(f.filename));

  console.log(`\n=== Sync Summary ===`);
  console.log(`Total files on disk: ${files.length}`);
  console.log(`Already in database: ${files.length - missing.length}`);
  console.log(`Missing (to upload): ${missing.length}`);
  console.log(`==================\n`);

  if (missing.length === 0) {
    console.log('No files to sync!');
    return;
  }

  let uploaded = 0;
  let failed = 0;
  let batch = 0;

  // Process in batches
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    batch++;
    const batchFiles = missing.slice(i, i + BATCH_SIZE);

    // Process batch with concurrency limit
    for (let j = 0; j < batchFiles.length; j += CONCURRENT_UPLOADS) {
      const chunk = batchFiles.slice(j, j + CONCURRENT_UPLOADS);

      const results = await Promise.all(chunk.map(async (file) => {
        const r2Key = `dataset_10/${file.filename}`;
        const stats = fs.statSync(file.path);

        const uploadOk = await uploadToR2(file.path, r2Key);
        if (!uploadOk) return false;

        const dbOk = await registerDocument(file.filename, r2Key, stats.size);
        return dbOk;
      }));

      for (const ok of results) {
        if (ok) uploaded++;
        else failed++;
      }
    }

    const progress = ((i + batchFiles.length) / missing.length * 100).toFixed(1);
    console.log(`Batch ${batch}: ${uploaded} uploaded, ${failed} failed (${progress}% complete)`);
  }

  console.log(`\n=== Final Results ===`);
  console.log(`Successfully uploaded: ${uploaded}`);
  console.log(`Failed: ${failed}`);
  console.log(`=====================\n`);
}

// Main
async function main() {
  console.log('Starting R2 sync for DataSet_10...\n');

  // Verify R2 credentials
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) {
    console.error('ERROR: R2 credentials not set. Required env vars:');
    console.error('  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
    process.exit(1);
  }

  // Verify data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`ERROR: Data directory not found: ${DATA_DIR}`);
    process.exit(1);
  }

  console.log('Getting existing files from database...');
  const existingFiles = await getExistingFilenames();
  console.log(`Found ${existingFiles.size} files in database`);

  console.log('\nScanning local files...');
  const localFiles = getLocalFiles();
  console.log(`Found ${localFiles.length} PDF files on disk`);

  await processFiles(localFiles, existingFiles);

  await pool.end();
  console.log('Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
