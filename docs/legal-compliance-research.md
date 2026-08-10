# Legal Compliance Research Notes

Last updated: 2026-05-31

This note records the legal sources checked for the current public terms, privacy policy, cookie posture, checkout acknowledgements, and provider-info risk. It is not branding copy. It is an operational checklist for keeping vectiscode honest.

## Sources Checked

- German DDG section 5: paid or business-like digital services must keep provider information easily recognizable, directly reachable, and permanently available. The listed information includes name and address, and for legal entities also legal form and representative details where applicable.
- German DDG section 33: missing, incorrect, or incomplete DDG section 5 information can be an administrative offense.
- German TDDDG section 25: storing or reading information on a user's device generally needs consent, unless it is strictly necessary to transmit a communication or provide the digital service expressly requested by the user.
- BfDI cookie-banner guidance: non-essential tracking technologies need consent, users need a real reject choice, and consent must be understandable and revocable.
- GDPR Article 13: privacy notices need controller identity and contact details, purposes, legal bases, legitimate interests where used, recipients, third-country transfer information where relevant, retention information, data subject rights, complaint rights, whether data is required, and automated-decision information where relevant.
- BGB section 312g: consumers generally have a withdrawal right for distance contracts.
- BGB section 356: for paid digital content not supplied on a physical medium, withdrawal can expire after performance begins only if the user expressly consented to early performance, acknowledged loss of the right, and the trader supplied the required confirmation under BGB section 312f.
- BGB section 357 and 357a: refunds after withdrawal generally happen within 14 days. For paid services started during the withdrawal period, proportionate compensation can be owed if the legal conditions are met. For digital content, section 357a says no compensation is owed after withdrawal, which is why the section 356 digital-content loss conditions matter.
- BGB section 312f: distance-contract confirmation must be supplied on a durable medium. For digital content, it must record the user's express consent and acknowledgement where relevant.
- EGBGB Article 246a section 1 and Annex 2: consumer pre-contract information and a model withdrawal form are required where a withdrawal right exists.

## Codebase Findings

- Necessary app cookies are `ras_session`, `ras_oauth_state`, and `ras_oauth_mode`.
- Session and OAuth cookies use `SameSite=Lax`; production sessions also use secure cookies.
- Authenticated production browser mutations have an API-side CSRF origin check. Studio connector calls remain connector-token protected and Stripe webhooks remain signature protected.
- Firebase Auth may use browser storage such as IndexedDB or localStorage for login.
- The web app uses `vectis-*` localStorage keys for preferences and app state.
- Client diagnostics send error reports to the API.
- Cloudflare Web Analytics is active on the live site. It is not advertising tracking, but if any non-essential analytics setup changes, a consent layer may be needed before it runs.
- Checkout and top-up requests now require `immediateAccessRequested` and `withdrawalAcknowledged` fields on the API side, and the web UI requires the checkbox before purchase.
- The public legal text uses the product name `vectiscode` and contact email only. It does not use fake location details, fake legal names, private guesses, or address placeholders.
- Self-serve workspace runtime deletion now removes synced snapshots, snapshot chunks, chats, messages, attachments, change sets, apply results, and Studio logs. Billing, ledger, security, fraud-prevention, and legal evidence records are retained where needed.

## Current Risk Position

The public release text is intentionally branded as `vectiscode` only and does not publish a private operator name or location details. Do not add fake provider details, private guesses, AI-generated addresses, or made-up company names.

If a target market requires additional statutory provider identity details for paid consumer sales, solve that operationally before broad paid launch. Acceptable solutions may include a proper business entity, a valid business service address, market-specific launch scoping, or jurisdiction-specific legal review. Do not satisfy a mandatory identity rule with placeholder text.

## Refund and Withdrawal Position

Do not say "no refunds" as an absolute rule for consumers. The safer wording is:

- 14-day statutory withdrawal rights remain unaffected where they apply.
- Users can request immediate access.
- Used credits and delivered digital outputs are not voluntarily refundable.
- For digital content, withdrawal can expire after performance begins only when the required express consent, acknowledgement, and confirmation conditions are met.
- For digital services, proportionate compensation may be deducted when the service began during the withdrawal period and the user was properly informed and requested early performance.

## Practical Next Steps

- Keep public legal pages limited to verified vectiscode facts. Do not publish private names, private addresses, or placeholders.
- Ensure Stripe confirmation emails, invoices, or app emails provide a durable-medium contract confirmation that includes the immediate-access consent and withdrawal acknowledgement.
- Keep Cloudflare Web Analytics as the only analytics layer unless a consent banner is added first.
- If marketing pixels, session replay, ad tracking, or non-essential personalization are added, implement a proper consent banner with accept and reject choices before those tools run.
