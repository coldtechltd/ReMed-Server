// Sentry has to be initialised before ANY other module is imported. The SDK
// instruments libraries (express, pg, http) through a require hook, and a
// module already sitting in the require cache is never patched — so an init
// that runs after `import { AppModule }` produces traces with no database or
// HTTP spans in them. main.ts imports this file on its very first line, and
// nothing may be imported above it there.
import { config } from 'dotenv';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

// ConfigModule.forRoot() is what normally populates process.env, but it does
// not run until app.module.ts is imported — which is now *after* this file.
// Without loading .env here SENTRY_DSN is undefined and the SDK silently
// no-ops, which looks exactly like a working setup that reports nothing.
// quiet: dotenv v17 prints a banner to stdout on every boot, which just adds
// noise to the PM2 logs.
config({ quiet: true });

// Sampling is deliberately low in production: the reminder cron alone opens a
// transaction every 60s, so tracing everything burns the quota on background
// noise rather than on real user traffic. Override with
// SENTRY_TRACES_SAMPLE_RATE when actively debugging.
const isProduction = process.env.NODE_ENV === 'production';
const sampleRate = process.env.SENTRY_TRACES_SAMPLE_RATE
  ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
  : isProduction
    ? 0.1
    : 1.0;

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Without these two, dev and production events land in the same
  // undifferentiated bucket and there is no release to attach source maps to,
  // so every stack trace points at dist/ line numbers. Set SENTRY_RELEASE at
  // deploy time (a git sha works; package.json's version is still 0.0.1 and is
  // not a useful fallback).
  environment: process.env.NODE_ENV ?? 'development',
  release: process.env.SENTRY_RELEASE,
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: sampleRate,
  profilesSampleRate: sampleRate,
});
