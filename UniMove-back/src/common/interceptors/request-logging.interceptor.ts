import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const started = Date.now();
    const req = context
      .switchToHttp()
      .getRequest<Request & { requestId?: string; user?: { id: string } }>();
    const res = context.switchToHttp().getResponse<Response>();
    const requestId = String(req.headers['x-request-id'] ?? randomUUID());
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    res.once('finish', () =>
      this.logger.log(
        JSON.stringify({
          requestId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Date.now() - started,
          userId: req.user?.id,
        }),
      ),
    );
    return next.handle();
  }
}
