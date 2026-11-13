import { NotificationType } from '../../generated/prisma/enums';
import { BroadcastUsageError, parseBroadcastArgs } from './notifications-broadcast.cli';

describe('notifications broadcast command', () => {
  it('defaults to a promotion simulation for every active account', () => {
    expect(
      parseBroadcastArgs(['--title', ' Semana gratuita ', '--message', 'Caronas sem custo.']),
    ).toEqual({
      title: 'Semana gratuita',
      message: 'Caronas sem custo.',
      type: NotificationType.PROMOTION,
      recipients: [],
      confirm: false,
    });
  });

  it('accepts system notices for specific accounts after confirmation', () => {
    expect(
      parseBroadcastArgs([
        '--type',
        'system',
        '--to',
        'Ana@UCB.edu.br, bruno@ucb.edu.br',
        '--title',
        'Manutenção',
        '--message',
        'O app ficará indisponível às 23h.',
        '--confirm',
      ]),
    ).toMatchObject({
      type: NotificationType.SYSTEM,
      recipients: ['ana@ucb.edu.br', 'bruno@ucb.edu.br'],
      confirm: true,
    });
  });

  it.each([
    [['--message', 'Sem título']],
    [['--title', 'Sem mensagem']],
    [['--title', 'x', '--message', 'y', '--type', 'RIDE_STARTED']],
    [['--title', '--message', 'y']],
  ])('rejects invalid usage %j', (argv) => {
    expect(() => parseBroadcastArgs(argv)).toThrow(BroadcastUsageError);
  });
});
