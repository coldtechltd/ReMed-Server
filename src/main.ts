import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

import { ValidationPipe, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Initialize Sentry
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      nodeProfilingIntegration(),
    ],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
  });

  const app = await NestFactory.create(AppModule);

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
  app.enableCors({
    origin: process.env.FRONTEND_URL || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('Med App Server')
    .setDescription('The Med App API description')
    .setVersion('1.0')
    .addTag('med-app')
    .addBearerAuth()
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, documentFactory);

  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  logger.log(`Server started on http://localhost:${port}`);
  logger.log(`Swagger documentation available on http://localhost:${port}/docs`);
}

bootstrap();
