// Must stay first: Sentry.init() runs here, and it has to happen before any
// instrumented library (express, pg, http) is pulled into the require cache.
import './instrument';

import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

import { ValidationPipe, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Sentry.init() already ran in ./instrument, imported above.
  const isProduction = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create(AppModule);

  // Behind the nginx reverse proxy every connection arrives from 127.0.0.1.
  // Without this, `req.ip` is the loopback address on *every* request, which
  // collapses the per-IP ThrottlerGuard into one shared 100 req/min bucket for
  // the whole user base and records 127.0.0.1 as the client on every
  // audit_logs row. 'loopback' honours X-Forwarded-For only when the peer is
  // local, so a request that reaches the port directly cannot spoof its IP.
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');

  // Global Filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS
  // CORS. FRONTEND_URL may be a comma-separated allowlist. When unset, reflect
  // the request origin (`true`) instead of '*', since a literal '*' is invalid
  // alongside credentials and would be rejected by browsers.
  const allowedOrigins = process.env.FRONTEND_URL?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins?.length ? allowedOrigins : true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Swagger documents every route and DTO shape; keep it off the public
  // internet. Set ENABLE_SWAGGER=true to expose it on a deployed environment.
  const enableSwagger = !isProduction || process.env.ENABLE_SWAGGER === 'true';

  if (enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('Med App Server')
      .setDescription('The Med App API description')
      .setVersion('1.0')
      .addTag('med-app')
      .addBearerAuth()
      .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, documentFactory);
  }

  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  logger.log(`Server started on http://localhost:${port}`);
  if (enableSwagger) {
    logger.log(
      `Swagger documentation available on http://localhost:${port}/docs`,
    );
  }
}

bootstrap();
