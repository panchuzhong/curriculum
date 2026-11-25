import { it, expect } from 'vitest';
import request from 'supertest';
import { setupApp, makeUser, auth } from './route-helpers.js';
import { teachers } from '../db/schema.js';
import { hashApiKey, maskApiKey } from '../services/api-keys.js';

it('keeps legacy keys usable, removes plaintext and never accepts a stored digest as a key', async () => {
  const { app, drizzleDb } = await setupApp('/api/auth', '../routes/auth.js');
  const user = await makeUser(drizzleDb);
  const oldKey = 'key-testuser';
  expect((await request(app).get('/api/auth/profile').set('X-API-Key', oldKey)).status).toBe(200);
  const stored = drizzleDb.select().from(teachers).get();
  expect(stored.apiKey).toBeNull();
  expect(stored.apiKeyHash).toBe(hashApiKey(oldKey));
  expect(stored.apiKeyHint).toBe(maskApiKey(oldKey));
  expect((await request(app).get('/api/auth/profile').set('X-API-Key', stored.apiKeyHash)).status).toBe(401);

  const rotation = await request(app).put('/api/auth/api-key').set(auth(user.token));
  expect(rotation.status).toBe(200);
  const key = rotation.body.apiKey;
  expect(drizzleDb.select().from(teachers).get()).toMatchObject({
    apiKey: null, apiKeyHash: hashApiKey(key), apiKeyHint: maskApiKey(key),
  });
  expect((await request(app).get('/api/auth/profile').set('X-API-Key', oldKey)).status).toBe(401);
  const profile = await request(app).get('/api/auth/profile').set('X-API-Key', key);
  expect(profile.status).toBe(200);
  expect(profile.body.apiKey).toBe(maskApiKey(key));
  expect(JSON.stringify(profile.body)).not.toContain(hashApiKey(key));
});
