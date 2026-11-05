import express from 'express';
import request from 'supertest';
import { configureProxyTrust, parseProxyHops } from './proxy-trust';

describe('bounded reverse-proxy trust', () => {
  it.each(['true', '2', '-1', '1,2', 'loopback'])(
    'rejects unrestricted or ambiguous trust: %s',
    (value) => {
      expect(() => parseProxyHops(value)).toThrow('TRUST_PROXY_HOPS');
    },
  );

  it('ignores forwarded addresses when proxy trust is disabled', async () => {
    const app = express();
    configureProxyTrust(app, parseProxyHops(undefined));
    app.get('/ip', (req, res) => res.json({ ip: req.ip }));
    const response = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.99');
    expect(response.body.ip).not.toBe('203.0.113.99');
  });

  it('uses only the closest forwarded hop, ignoring a spoofed address before it', async () => {
    const app = express();
    configureProxyTrust(app, parseProxyHops('1'));
    app.get('/ip', (req, res) => res.json({ ip: req.ip }));
    const response = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.99, 198.51.100.25');
    expect(response.body.ip).toBe('198.51.100.25');
  });
});
