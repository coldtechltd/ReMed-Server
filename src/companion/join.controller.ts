import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { normalizeInviteCode } from './invite-code.util';

const APP_SCHEME = 'medapp';
const APP_STORE_URL = 'https://apps.apple.com/app/remed';
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.coldtech.medapp';

/**
 * The landing page an invite link opens.
 *
 * Deliberately public and deliberately dumb: it does NOT look the code up, so
 * it reveals nothing about whether a code is real, who sent it, or what they
 * take. It only hands the code to the app, which redeems it over an
 * authenticated request. That is what keeps a forwarded link from being a
 * credential.
 */
@ApiExcludeController()
@Controller()
export class JoinController {
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get('join/:code')
  @Header('Content-Type', 'text/html; charset=utf-8')
  // No caching: the page embeds the code from the path.
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  join(@Param('code') code: string): string {
    // Normalize and re-encode before it reaches the template — the raw path
    // segment is untrusted input being written into HTML and a URL.
    const safe = normalizeInviteCode(code).slice(0, 16);
    const deepLink = `${APP_SCHEME}://join?code=${encodeURIComponent(safe)}`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Your ReMed invite</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 3rem 1.25rem 5rem; max-width: 26rem; text-align: center;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1e293b; background: #fffdf9;
  }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { color: #475569; }
  .code {
    display: inline-block; margin: 1.5rem 0; padding: .75rem 1.25rem;
    font: 600 1.5rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .15em; background: #f1f5f9; border-radius: .75rem; color: #0f766e;
  }
  .btn {
    display: block; margin: .75rem 0; padding: .9rem 1rem; border-radius: .75rem;
    background: #0f766e; color: #fff; text-decoration: none; font-weight: 600;
  }
  .btn.secondary { background: transparent; color: #0f766e; border: 1px solid #cbd5e1; }
  .stores { margin-top: 2rem; font-size: .9rem; }
  .stores a { color: #0f766e; }
  @media (prefers-color-scheme: dark) {
    body { color: #e2e8f0; background: #0f172a; }
    p { color: #94a3b8; }
    .code { background: #1e293b; color: #6ee7b7; }
    .btn { background: #6ee7b7; color: #0f172a; }
    .btn.secondary { background: transparent; color: #6ee7b7; border-color: #334155; }
    .stores a { color: #6ee7b7; }
  }
</style>
</head>
<body>
<h1>You've been invited to ReMed</h1>
<p>Someone would like you to help keep an eye on their medications. You'll be able to see their doses — you won't be able to change anything.</p>

<div class="code">${safe}</div>

<a class="btn" href="${deepLink}">Open in ReMed</a>

<div class="stores">
  <p>Don't have the app yet? Install it, then enter the code above.</p>
  <p>
    <a href="${APP_STORE_URL}">App Store</a> &middot;
    <a href="${PLAY_STORE_URL}">Google Play</a>
  </p>
</div>

<script>
  // Try the app straight away. If it isn't installed nothing happens and the
  // page stays put with the code visible — no redirect to a broken store page.
  window.location.href = ${JSON.stringify(deepLink)};
</script>
</body>
</html>`;
  }
}
