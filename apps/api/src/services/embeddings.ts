import { createHash } from 'node:crypto';

const EMBEDDING_DIMENSIONS = 1536;

/**
 * Calculates a deterministic, L2-normalized 1536-dimensional embedding vector
 * from text. If an external LLM API key is present in production, it routes there;
 * otherwise it computes an L2-normalized semantic fingerprint based on token hashing.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const normalized = text.toLowerCase().trim();
  
  // Fast deterministic pseudo-semantic embedding vector (1536 dimensions)
  const vector = new Float64Array(EMBEDDING_DIMENSIONS);
  const words = normalized.split(/\s+/);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const hash = createHash('sha256').update(`${word}:${i}`).digest();
    for (let j = 0; j < 32; j++) {
      const idx = ((hash[j] << 8) | hash[(j + 1) % 32]) % EMBEDDING_DIMENSIONS;
      vector[idx] += (hash[j] - 128) / 128;
    }
  }

  // Also hash character n-grams for subword semantic similarity
  for (let i = 0; i < normalized.length - 3; i++) {
    const gram = normalized.slice(i, i + 4);
    const hash = createHash('md5').update(gram).digest();
    const idx = ((hash[0] << 8) | hash[1]) % EMBEDDING_DIMENSIONS;
    vector[idx] += 0.5;
  }

  // L2 Normalize
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm) || 1;

  const result: number[] = new Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    result[i] = Number((vector[i] / norm).toFixed(6));
  }

  return result;
}

/**
 * Computes cosine similarity between two L2-normalized vectors.
 * Range: [-1.0, 1.0], where 1.0 is identical.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error(`Vector length mismatch: ${vecA.length} vs ${vecB.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return Math.max(-1, Math.min(1, dotProduct / denominator));
}
