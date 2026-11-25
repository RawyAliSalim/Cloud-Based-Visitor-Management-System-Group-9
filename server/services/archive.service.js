// Check-in/Check-out and Visitor Log Service: archives every exported visitor-log CSV in S3,
// so the security team keeps a copy of what was exported and when.
// Active only when REPORTS_BUCKET is set (the floci deployment); otherwise it does nothing.
// The AWS SDK is part of the Lambda runtime, so it is loaded only when S3 is actually used.
const logger = require('../utils/logger');

let client = null;

function s3() {
  if (!client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    // Path-style URLs (http://floci:4566/bucket/key) work with floci and with real S3.
    client = new S3Client({ forcePathStyle: true });
  }
  return client;
}

function isEnabled() {
  return Boolean(process.env.REPORTS_BUCKET);
}

// Returns the s3:// location of the archived file, or null when archiving is not enabled.
async function archiveReport({ fileName, csv, exportedBy }) {
  if (!isEnabled()) {
    return null;
  }
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const bucket = process.env.REPORTS_BUCKET;
  const day = new Date().toISOString().slice(0, 10);
  const key = `reports/${day}/${Date.now()}-${fileName}`;
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: csv,
      ContentType: 'text/csv; charset=utf-8',
      ServerSideEncryption: 'AES256',
      Metadata: { 'exported-by': String(exportedBy) }
    })
  );
  logger.info('report.archived', { bucket, key });
  return `s3://${bucket}/${key}`;
}

module.exports = { archiveReport, isEnabled };
