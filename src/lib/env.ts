function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}. Copy .env.example to .env.local and fill it in.`);
  return v;
}

export const env = {
  storeHash: req('BIGCOMMERCE_STORE_HASH'),
  accessToken: req('BIGCOMMERCE_ACCESS_TOKEN'),
  apiUrl: process.env.BIGCOMMERCE_API_URL ?? 'https://api.bigcommerce.com',
  channelId: Number(process.env.BIGCOMMERCE_CHANNEL_ID ?? 1),
  channelName: process.env.BIGCOMMERCE_CHANNEL_NAME ?? 'Default channel',
  openaiApiKey: req('OPENAI_API_KEY'),
  model: process.env.OPENAI_MODEL ?? 'gpt-5.6-luna',
  visionModel: process.env.OPENAI_VISION_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.6-luna',
  reasoningEffort: (process.env.OPENAI_REASONING_EFFORT ?? 'low') as 'low' | 'medium' | 'high',
  /** Local SQLite file, used whenever TURSO_DATABASE_URL is absent. */
  dbPath: process.env.DATABASE_PATH ?? './data/enricher.db',
  tursoUrl: process.env.TURSO_DATABASE_URL,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN,
  /** Local upload directory, used whenever BLOB_READ_WRITE_TOKEN is absent. */
  uploadDir: process.env.UPLOAD_DIR ?? './data/uploads',
  blobToken: process.env.BLOB_READ_WRITE_TOKEN,
};

// On Vercel the local fallbacks would write to a read-only, per-instance filesystem and fail
// confusingly at the first write. Refuse to start instead.
if (process.env.VERCEL) {
  const missing = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'BLOB_READ_WRITE_TOKEN'].filter(
    (name) => !process.env[name],
  );
  if (missing.length) {
    throw new Error(`Missing ${missing.join(', ')}. Deployments need Turso and Vercel Blob configured.`);
  }
}
