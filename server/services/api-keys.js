import { createHash } from 'node:crypto';

// Keys are random UUIDs, so a fast one-way digest is suitable (unlike passwords).
export const hashApiKey = key => createHash('sha256').update(key).digest('hex');
export const maskApiKey = key => key ? `${key.slice(0, 4)}...${key.slice(-4)}` : null;
