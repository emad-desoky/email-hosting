# Deployment and activation checklist

## Scope
This repository is dedicated to MDS Healthcare mail hosting. Existing MDS repositories and Vercel projects must remain untouched.

## Verified connected resources
- GitHub: `emad-desoky/email-hosting` (repository currently **PUBLIC**; change to Private before storing proprietary code).
- Supabase organization: `email-hosting-portal`
- Supabase project: `mofmsilrpahzrxmwqulf`
- Supabase URL: `https://mofmsilrpahzrxmwqulf.supabase.co`
- Database schema created and verified (mailboxes, messages, attachments, audit_events, RLS enabled).
- Resend sending domain has been shown as verified by the project owner.

## Outstanding blockers (not live yet)
1. Vercel connector 403 (team scope not authorized). Need to reauthorize Vercel, including correct project/team access, and link only the new repository.
2. Supabase management connection provides publishable keys but does not expose the required server secret. Owner must set `SUPABASE_SECRET_KEY` directly in new Vercel project.
3. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `RESEND_API_KEY`, and `RESEND_WEBHOOK_SECRET` through encrypted Vercel environment settings.
4. A first administrator must be provisioned through Supabase Auth with an associated `mailboxes` row with `role='admin'`.
5. Configure webhook signature verification in Resend, signed `email.received` webhook endpoint, and receiving MX records only after checking for existing mail services.
6. Validate the Resend receiving SDK/API implementation and test end-to-end sending/receiving.
7. Configure offsite database and attachment-storage backups; attachment upload/archive pipeline remains to be implemented.
8. Finish administrator mailbox switcher and other remaining user-facing flows; test authentication expiry and multi-mailbox access.
9. Run `npm install` and `npm run build` in a network-enabled CI environment. Network restrictions prevented local clone/build verification.

**Do not market or use this as a complete live email service until items above pass.**

## Site
Target standalone Vercel host: `email-hosting.vercel.app`, if available. No MDS website custom domain is required, although addresses use `@mds-healthcare.com`.
