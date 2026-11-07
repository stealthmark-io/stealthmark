import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { POST } from '../app/api/subscribe/route';
import { jsonPost, stubLeadChannels } from './helpers/lead-channels';

const URL = 'http://localhost/api/subscribe';

describe('/api/subscribe update requests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('accepts a valid email once a channel delivered it, without echoing an internal address', async () => {
    const sent = stubLeadChannels({ configure: ['discord'] });
    const res = await POST(jsonPost(URL, { email: 'researcher@agentic.ai' }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data).not.toHaveProperty('routedTo');
    expect(JSON.stringify(data)).not.toContain('@stealthmark.io');
    expect(sent).toHaveLength(1);
  });

  it('rejects invalid email addresses with 400 Bad Request', async () => {
    stubLeadChannels({ configure: ['discord'] });
    const res = await POST(jsonPost(URL, { email: 'invalid-email-string' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeDefined();
  });

  it('rejects empty payloads with 400 Bad Request', async () => {
    stubLeadChannels({ configure: ['discord'] });
    const res = await POST(jsonPost(URL, {}));
    expect(res.status).toBe(400);
  });
});
