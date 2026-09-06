/**
 * Static Privacy Policy and Terms of Service, served publicly so the App Store
 * and Play Console have reachable URLs and the paywall can link to them (Apple
 * requires both on any screen selling a subscription).
 *
 * The data-handling sections below were written to match what the code actually
 * stores and transmits — see `src/db/schema/*` for the fields and
 * `src/ai/ai.service.ts` for what leaves the server. Keep them in step when the
 * schema or third-party list changes.
 *
 * NOTE: this is a good-faith draft describing real behaviour, not legal advice.
 * Have a qualified lawyer review it before you take payments.
 */

export const COMPANY_NAME = 'ColdTech';
export const CONTACT_EMAIL = 'coldtechltd01@gmail.com';
export const APP_NAME = 'ReMed';
export const LAST_UPDATED = '5 September 2026';

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ${APP_NAME}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 2.5rem 1.25rem 5rem; max-width: 46rem;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1e293b; background: #fffdf9;
  }
  h1 { font-size: 1.75rem; margin-bottom: .25rem; }
  h2 { font-size: 1.15rem; margin-top: 2.25rem; }
  .updated { color: #64748b; font-size: .9rem; margin-top: 0; }
  ul { padding-left: 1.25rem; }
  li { margin: .35rem 0; }
  a { color: #0f766e; }
  code { background: #f1f5f9; padding: .1rem .3rem; border-radius: .25rem; font-size: .9em; }
  @media (prefers-color-scheme: dark) {
    body { color: #e2e8f0; background: #0f172a; }
    .updated { color: #94a3b8; }
    a { color: #6ee7b7; }
    code { background: #1e293b; }
  }
</style>
</head>
<body>
<h1>${title}</h1>
<p class="updated">${APP_NAME} — last updated ${LAST_UPDATED}</p>
${body}
<h2>Contact</h2>
<p>Questions about this document? Email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
</body>
</html>`;
}

export const PRIVACY_POLICY_HTML = page(
  'Privacy Policy',
  `
<p>${APP_NAME} is a medication reminder app operated by ${COMPANY_NAME}. This policy explains what we collect, why, and who it is shared with. We do not sell your data, and we do not show advertising.</p>

<h2>What we collect</h2>
<p><strong>Account.</strong> Your email address, and either a hashed password or a Google sign-in identifier. We never store your password in readable form.</p>
<p><strong>Health profile (optional).</strong> If you fill in a profile we store your name, date of birth, blood group, genotype, height, weight, gender, country, phone number, diagnosed conditions, allergies, and an emergency contact name and number. This is health information and we treat it as sensitive.</p>
<p><strong>Medications.</strong> The medications you add, their dosage forms, quantities on hand, schedules and timezone, and the record of each dose being taken, missed, or snoozed.</p>
<p><strong>Device.</strong> A device identifier and a push notification token for each installation, so reminders reach the right device and you can sign out of one device without affecting others.</p>

<h2>How we use it</h2>
<ul>
  <li>To send you medication reminders and refill alerts.</li>
  <li>To show your schedule, adherence statistics, and stock projections.</li>
  <li>To personalise the in-app wellness assistant.</li>
  <li>To keep your account secure and to diagnose faults.</li>
</ul>
<p>We do not use your health information for advertising or profiling, and we do not sell it to anyone.</p>

<h2>Who we share it with</h2>
<p>We use a small number of processors to run the service:</p>
<ul>
  <li><strong>Groq</strong> — powers the wellness assistant. When you use the AI tab we send your message, the recent conversation, and a summary of your medications and relevant profile details (diagnosed conditions, height, weight, gender) for processing. Do not enter anything in the chat you would not want processed this way.</li>
  <li><strong>Expo</strong> — delivers push notifications. Receives your push token and the reminder text.</li>
  <li><strong>Sentry</strong> — error monitoring, both in the app and on our servers. Receives crash and error reports: the fault itself, your device model, operating system and app version, and a short trail of the screens you opened and the requests the app made just before it, each recorded as a path without its query. Reports carry your account identifier so we can tell how many people a fault affects. We filter medication names, profile fields, and chat contents out of these reports; server-side reports may still incidentally include technical request details when something fails.</li>
  <li><strong>PostHog</strong> — product analytics. Receives which screens you open and which actions you take, keyed to your account identifier. It does not receive your medication names, profile fields, or chat contents.</li>
  <li><strong>Google</strong> — only if you choose to sign in with Google.</li>
  <li><strong>Apple and Google</strong> — process any subscription purchase. They handle your payment details directly; we never see your card.</li>
</ul>
<p>We may also disclose information where we are legally required to.</p>

<h2>Sharing with a companion</h2>
<p>You can invite someone — a partner, a family member, a carer — to follow your medications. Nothing is shared until you create an invite and they accept it, and you can end the sharing at any time from Settings.</p>
<p>While a companion link is active, that person can see:</p>
<ul>
  <li>your medications and their dosage forms, doses and schedules;</li>
  <li>your doses for a given day, your upcoming doses, and whether each was taken or missed;</li>
  <li>your adherence statistics, including streaks and a per-medication breakdown;</li>
  <li>your name, so they know whose information they are looking at.</li>
</ul>
<p>A companion cannot change anything. They cannot see the rest of your profile — your date of birth, blood group, genotype, height, weight, allergies, conditions, phone number or emergency contacts — and they cannot see your conversations with the assistant.</p>
<p>You can hide any individual medication from companions by marking it private, and a private medication is excluded from everything above, including alerts.</p>
<p>If they turn the alerts on, a companion also receives a push notification when you miss a dose and when a medication is running low. Those notifications name the medication concerned, so they can appear on their lock screen.</p>
<p>Either of you can end the link at any time, and access stops immediately. Because this is your health information being shared with another person, we record when a companion views your data.</p>

<h2>Security</h2>
<p>Your session token is held in the device's secure keystore (Keychain on iOS, Keystore on Android), not in ordinary app storage. You can additionally require Face ID, Touch ID, or your device passcode to open the app; that check happens entirely on your device and no biometric data ever reaches us. Traffic to our servers is encrypted in transit.</p>

<h2>Retention and your choices</h2>
<p>We keep your data while your account exists. You can edit or delete individual medications and profile fields at any time in the app. To delete your account and everything associated with it, email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> and we will action it within 30 days.</p>
<p>Depending on where you live you may have rights to access, correct, export, or erase your data, or to object to processing. Contact us at the address above to exercise them.</p>

<h2>Children</h2>
<p>${APP_NAME} is not directed at children under 13, and we do not knowingly collect their data. If you believe a child has given us information, contact us and we will remove it.</p>

<h2>Not medical advice</h2>
<p>${APP_NAME} is a reminder and record-keeping tool. It does not provide medical advice, diagnosis, or treatment, and the in-app assistant is expressly restricted from doing so. Always follow your doctor's or pharmacist's instructions.</p>

<h2>Changes</h2>
<p>If we change this policy we will update the date above and, for significant changes, notify you in the app.</p>
`,
);

export const TERMS_OF_SERVICE_HTML = page(
  'Terms of Service',
  `
<p>These terms govern your use of ${APP_NAME}, operated by ${COMPANY_NAME}. By using the app you agree to them.</p>

<h2>What ${APP_NAME} is — and is not</h2>
<p>${APP_NAME} helps you record medications and reminds you to take them. <strong>It is not a medical device and does not provide medical advice, diagnosis, or treatment.</strong> Nothing in the app — including anything the wellness assistant says — is a substitute for your doctor or pharmacist. Never start, stop, or change a medication because of something the app told you.</p>
<p>Reminders depend on your device, its operating system, its power settings, and your network. They can be delayed or missed for reasons outside our control. <strong>Do not rely on ${APP_NAME} as your only safeguard for a dose that matters.</strong> You remain responsible for taking your medication correctly.</p>

<h2>Your account</h2>
<p>You must be at least 13 years old. Keep your credentials secure and tell us promptly if you suspect unauthorised access. You are responsible for the accuracy of the information you enter — the app's schedules, stock projections, and statistics are only as correct as what you give it.</p>

<h2>${APP_NAME} Pro</h2>
<p>Some features require a paid subscription or a one-time purchase. Prices are shown in the app before you buy, in your local currency.</p>
<ul>
  <li>Purchases are processed by Apple or Google, not by us, and are governed by their terms as well as these.</li>
  <li>Subscriptions renew automatically for the same period unless you cancel at least 24 hours before the current period ends. Manage or cancel renewal in your App Store or Google Play account settings — uninstalling the app does not cancel a subscription.</li>
  <li>A lifetime purchase is a single payment granting access for as long as the app is offered. It does not renew.</li>
  <li>Refunds are handled by Apple or Google under their policies. We cannot issue them directly.</li>
  <li>Free-tier usage limits, including limits on the wellness assistant, may change. We will not reduce what you have already paid for during a period you have paid for.</li>
</ul>
<p>Medication reminders, medication tracking, refill alerts, and your emergency Medical ID remain available without payment.</p>

<h2>Acceptable use</h2>
<p>Do not attempt to breach or probe the service's security, use it to store information you have no right to hold, resell access, or automate abusive volumes of requests. We may suspend accounts that do.</p>

<h2>Availability</h2>
<p>We aim to keep ${APP_NAME} running but do not guarantee uninterrupted service, and we may change or discontinue features. We will give reasonable notice before withdrawing a paid feature.</p>

<h2>Liability</h2>
<p>To the fullest extent permitted by law, ${COMPANY_NAME} is not liable for any indirect or consequential loss, or for any harm arising from a missed, delayed, or incorrect reminder, or from reliance on information in the app. Nothing here limits liability that cannot lawfully be limited — including for death or personal injury caused by negligence. Where liability cannot be excluded, it is limited to the amount you paid us in the twelve months before the claim.</p>

<h2>Termination</h2>
<p>You may stop using ${APP_NAME} at any time and ask us to delete your account. We may suspend or terminate access for a serious or repeated breach of these terms.</p>

<h2>Changes</h2>
<p>We may update these terms; the date above shows when. Continued use after a change means you accept it.</p>
`,
);
