# Privacy Policy | vectiscode

**Last updated: May 31, 2026**

This Privacy Policy explains how vectiscode collects, uses, stores, and shares information when you use the vectiscode website, web app, backend API, AI features, billing features, and Roblox Studio plugin, together called the "Services".

For privacy questions, account deletion, data export requests, or security reports, contact **contact@vectiscode.com**.

## 1. Controller and Contact

vectiscode is responsible for this Privacy Policy.

Contact: **contact@vectiscode.com**

## 2. Information We Collect

### Account Data

When you sign in with Firebase, Google, Roblox OAuth, or another configured provider, we receive account data needed to create and secure your account. This may include your email address, display name, profile image URL, provider user ID, authentication provider, plan, account status, preferences, and admin status.

### Workspace and Plugin Data

If you connect the Roblox Studio plugin, the Services may process technical context from your Roblox project so the AI can answer questions and generate useful changes. This can include script names, source code, hierarchy structure, folder and instance names, selected safe instance properties, pending changes, approval state, connector session state, plugin version, sync status, and plugin logs.

### Prompts, Messages, Attachments, and Generated Output

We process prompts you submit, chat history, generated explanations, generated code patches, generated images or icons, uploaded attachments, selected model, safety checks, validation activity, and related metadata such as timestamps and credit usage.

### Billing Data

Payments are handled by Stripe. We do not store full payment card numbers. We store billing metadata needed to manage subscriptions and top-ups, such as Stripe customer IDs, subscription IDs, plan status, checkout status, invoice or transaction references, credit ledger entries, immediate-access acknowledgements, refund status, and cancellation status.

### Technical, Security, and Diagnostics Data

We collect server logs, request metadata, rate-limit information, IP-derived security signals, device and browser information, client error reports, diagnostics, WebSocket connection state, and security event evidence to keep the Services reliable and secure.

## 3. Purposes and Legal Bases

We use information to:

* Provide accounts, login, sessions, workspaces, AI responses, generated code, generated icons, billing, and support. Legal basis: contract performance or steps before entering a contract.
* Sync Roblox Studio context and deliver approved changes back to the plugin after user review and Studio confirmation. Legal basis: contract performance.
* Enforce plan limits, credit balances, rate limits, workspace permissions, and abuse protections. Legal basis: contract performance and legitimate interests.
* Debug errors, monitor reliability, measure service usage, and improve the product. Legal basis: legitimate interests or consent where required.
* Process payments, invoices, refunds, taxes, accounting obligations, and withdrawal-related records. Legal basis: contract performance and legal obligations.
* Detect misuse, malicious code requests, scraping, unauthorized automation, fraud, account compromise, and security incidents. Legal basis: legitimate interests and legal obligations.
* Respond to lawful requests and enforce legal claims. Legal basis: legal obligations and legitimate interests.

Where processing is based on legitimate interests, those interests are operating, securing, improving, and protecting vectiscode and its users.

Where processing is based on consent, you may withdraw consent at any time without affecting processing that occurred before withdrawal.

## 4. Cookies, Local Storage, and Analytics

Cookies and similar technologies store or read information on your device. Applicable device privacy rules may require consent for device storage or access unless it is strictly necessary to transmit a communication or provide a digital service expressly requested by the user.

We do not use advertising cookies or cross-site behavioral advertising pixels. We use cookies and browser storage for login, security, OAuth protection, preferences, diagnostics, and basic analytics.

| Name or technology | Type | Purpose | Typical duration |
| --- | --- | --- | --- |
| `ras_session` | Strictly necessary HTTP-only cookie | Keeps you signed in and authenticates API and WebSocket requests. It is set with `SameSite=Lax` and `Secure` in production. | Up to 30 days |
| `ras_oauth_state` | Strictly necessary HTTP-only cookie | Protects Google or OAuth login callbacks from forged requests. | Up to 10 minutes |
| `ras_oauth_mode` | Strictly necessary HTTP-only cookie | Remembers whether OAuth login is running in a popup flow. | Up to 10 minutes |
| Firebase Auth browser storage | Strictly necessary provider storage | Supports Firebase Google sign-in and token handling in the browser. Firebase may use IndexedDB, localStorage, or similar browser storage depending on browser support. | Managed by Firebase and browser settings |
| `vectis-*` localStorage keys | Preference and workspace storage | Remembers theme, color settings, plan mode, optimization mode, file reference settings, Luau Guard setting, and short-lived login redirect state. | Until cleared by you or the browser |
| Client error beacons | Diagnostics | Sends limited frontend error reports to our API so we can fix crashes and failed requests. | Event based |
| Cloudflare Web Analytics | Analytics | Measures page views and basic website performance without advertising cookies. Cloudflare may also process request and network telemetry for security and delivery. | Controlled by Cloudflare settings |

You can clear cookies and local storage in your browser. Doing so may log you out and reset preferences. Because login and security cookies are necessary for the Services, the authenticated app cannot work without them.

Non-essential analytics, advertising, personalization, session replay, or cross-site tracking must not be enabled unless a valid consent flow is shown before that technology runs.

## 5. Service Providers and Recipients

We use third-party providers to operate the Services. Depending on configuration and the feature you use, these may include:

* **Firebase** for Google login authentication.
* **Supabase** for database and attachment storage.
* **Hugging Face Spaces** for API hosting.
* **Cloudflare** for website hosting, DNS, caching, security, network telemetry, and Web Analytics.
* **Stripe** for subscriptions, checkout, billing portal, invoices, payment methods, tax support, and refunds.
* **Roblox APIs** for OAuth, marketplace-related features, or platform integration when configured.
* **AI model API providers** such as Google Cloud Vertex AI and Yunwu for processing prompts and generating code.

We send providers only the information needed for the feature being used. For example, payment details go to Stripe, login tokens go to Firebase, and AI prompts plus relevant workspace context go to the selected AI provider.

Some providers may process data outside your country or outside the European Economic Area. Where GDPR transfer rules apply, transfers should rely on an adequacy decision, standard contractual clauses, or another valid transfer mechanism provided by the relevant provider.

## 6. AI Processing and Training

vectiscode does not use your private prompts, code, workspace snapshots, uploaded files, or generated outputs to train its own AI models.

When you ask the AI for help, relevant prompts, messages, attachments, generated context, and workspace data may be sent to the configured AI provider so it can generate a response. Provider handling depends on the provider and account configuration. We choose API-based providers intended for application use and do not intentionally send your private workspace data to consumer chat products.

You should avoid submitting secrets, private keys, passwords, API tokens, or third-party confidential material unless it is necessary for support and you are allowed to share it.

## 7. Retention and Deletion

We keep account data while your account is active. We keep billing records, invoices, tax records, transaction evidence, consent records, security records, and legal dispute records for as long as required or permitted by applicable law.

Workspace snapshots, messages, generated outputs, attachments, change sets, apply results, plugin logs, client error reports, and diagnostics are kept as long as needed to provide the Services, troubleshoot issues, enforce limits, and support your account.

You can clear workspace runtime data from the app. This removes synced snapshots, chat history, attachments, pending change sets, apply results, and Studio logs for the workspace. It does not remove account records, billing records, credit ledger records, fraud-prevention records, tax records, or legal evidence that must be retained.

You can request account deletion, workspace deletion, or data export by contacting **contact@vectiscode.com**. Some records may be retained where we have a legal obligation or a legitimate need to prevent fraud, resolve disputes, secure the Services, or enforce our Terms.

## 8. Your Rights

Depending on your location, you may have the right to request access, correction, deletion, restriction, portability, objection, and withdrawal of consent where processing is based on consent.

If GDPR applies, you may also object to processing based on legitimate interests and lodge a complaint with a supervisory data protection authority.

To exercise these rights, contact **contact@vectiscode.com**.

If you are a California resident, we do not sell personal information and do not share it for cross-context behavioral advertising. You may request access or deletion by contacting us.

## 9. Required or Optional Data

Some data is required to use vectiscode. For example, account, session, billing, credit balance, workspace context, and plugin connection data may be necessary for login, paid plans, AI features, Studio sync, and patch delivery. If you do not provide required data, parts of the Services may not work.

Optional data, such as preferences, support details, uploaded attachments, or generated icon prompts, may improve the product or help us solve a specific request.

## 10. Automated Decisions

We may use automated systems to enforce rate limits, detect abuse, route AI requests, calculate credit usage, estimate costs, perform safety checks, and protect accounts. These systems do not intentionally make legal or similarly significant decisions about you without human review where such review is required by law.

## 11. Security

We use HTTPS/TLS, HTTP-only cookies for app sessions, production secure cookies, same-site cookie restrictions, CSRF origin checks for authenticated browser mutations, provider-managed authentication, access controls, rate limits, abuse detection, connector tokens, and encrypted provider infrastructure where available.

No online service is perfectly secure, so please report suspected security issues to **contact@vectiscode.com**.

## 12. Children

The Services are not intended for children under 13. If you are under the age of majority where you live, you should use the Services only with permission from a parent or legal guardian.

## 13. Changes

We may update this Privacy Policy as the product, providers, or law changes. If we make material changes, we will update the date above and may notify users in the app, by email, or through another reasonable method.

## 14. Contact

For privacy requests, data deletion, data export, or security questions, contact:

**contact@vectiscode.com**
