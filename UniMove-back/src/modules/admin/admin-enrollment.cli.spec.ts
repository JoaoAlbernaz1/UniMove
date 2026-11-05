jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verify: jest.fn(),
}));

import { runEnrollment, serveEnrollmentQr } from './admin-enrollment.cli';

describe('operator enrollment CLI', () => {
  const service = {
    begin: jest.fn().mockResolvedValue({
      qrCode: 'data:image/png;base64,AAAA',
      secret: 'NEVER-LOG-SECRET',
      issuer: 'fixture',
    }),
    confirm: jest.fn().mockResolvedValue({ recoveryCodes: ['AAAAA-BBBBB'] }),
  };
  const close = jest.fn().mockResolvedValue(undefined);
  const io = {
    question: jest.fn(),
    showQr: jest.fn().mockResolvedValue(close),
    showRecoveryCodes: jest.fn(),
  };
  beforeEach(() => jest.clearAllMocks());

  it('requires explicit confirmation before any enrollment write', async () => {
    io.question.mockResolvedValueOnce('no');
    await expect(runEnrollment('admin@ucb.edu.br', service, io)).rejects.toThrow();
    expect(service.begin).not.toHaveBeenCalled();
    expect(io.showQr).not.toHaveBeenCalled();
  });

  it('reads a code interactively, discloses recovery codes once and closes private QR', async () => {
    io.question
      .mockResolvedValueOnce('PROVISIONAR admin@ucb.edu.br')
      .mockResolvedValueOnce('123456');
    await runEnrollment('ADMIN@UCB.EDU.BR', service, io);
    expect(service.confirm).toHaveBeenCalledWith('admin@ucb.edu.br', '123456');
    expect(io.showQr).toHaveBeenCalledWith('data:image/png;base64,AAAA');
    expect(io.showRecoveryCodes).toHaveBeenCalledWith(['AAAAA-BBBBB']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the QR without disclosing recovery codes when verification fails', async () => {
    io.question.mockResolvedValueOnce('PROVISIONAR admin@ucb.edu.br').mockResolvedValueOnce('bad');
    service.confirm.mockRejectedValueOnce(new Error('invalid'));
    await expect(runEnrollment('admin@ucb.edu.br', service, io)).rejects.toThrow('invalid');
    expect(io.showRecoveryCodes).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('serves the QR only on a random loopback URL with no-store and closes it', async () => {
    const server = await serveEnrollmentQr('data:image/png;base64,AAAA');
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]{36}$/);
      const response = await fetch(server.url);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toContain('data:image/png;base64,AAAA');
      expect((await fetch(new URL('/', server.url))).status).toBe(404);
      expect((await fetch(server.url, { method: 'POST' })).status).toBe(404);
    } finally {
      await server.close();
    }
    await expect(fetch(server.url)).rejects.toThrow();
  });
});
