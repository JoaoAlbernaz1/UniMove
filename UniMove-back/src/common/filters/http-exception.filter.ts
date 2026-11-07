import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : undefined;
    const body = typeof payload === 'object' && payload ? (payload as Record<string, unknown>) : {};
    const message =
      status === 500
        ? 'Erro interno do servidor.'
        : (body.message ?? payload ?? 'Erro na requisição.');
    if (status >= 500) {
      const requestWithId = request as Request & { requestId?: string };
      this.logger.error(
        JSON.stringify({
          requestId: requestWithId.requestId,
          method: request.method,
          path: request.path,
          status,
          errorType: exception instanceof Error ? exception.name : typeof exception,
          // Só nas suítes de integração, e nunca em produção: o primeiro quadro
          // da pilha diz o arquivo e a linha onde o erro nasceu, que é o que
          // falta quando um 5xx aparece no runner. Segue sem mensagem, sem
          // parâmetro da consulta e sem dado de pessoa.
          ...(process.env.INTEGRATION_LOG === '1' && process.env.NODE_ENV !== 'production'
            ? {
                origem:
                  exception instanceof Error ? exception.stack?.split('\n')[1]?.trim() : undefined,
              }
            : {}),
        }),
      );
    }
    response.status(status).json({
      statusCode: status,
      code: body.code ?? `HTTP_${status}`,
      message,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }
}
