import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
// @SentryExceptionCaptured() emits decorator metadata for this signature, which
// requires the referenced types to be imported as types under isolatedModules.
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  // This filter is registered with a bare @Catch(), so it intercepts *every*
  // exception before any other filter could. Without this decorator Sentry
  // never sees a single request error - they would only ever reach the local
  // logger below.
  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error', statusCode: status };

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      error: typeof message === 'string' ? { message } : message,
    };

    // Log the error for production tracking
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} ${status} - Error: ${JSON.stringify(exception)}`,
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} ${status} - Warning: ${JSON.stringify(message)}`,
      );
    }

    response.status(status).json(errorResponse);
  }
}
