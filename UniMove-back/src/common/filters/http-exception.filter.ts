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
