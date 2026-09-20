# Email and Payments Research

## Recommendation

Use Resend for magic links and weekly digests, and Stripe Checkout/Billing for the $5/month subscription. Start email on Resend Free, but move to Pro before the Tuesday send exceeds 100 recipients.

## Email Cost and Operations

- Resend Free: $0/month, 3,000 emails/month, and 100 emails/day. The daily cap matters more than the monthly quota because Front Row sends its digest on Tuesday.
- Resend Pro: $20/month, 50,000 emails/month, no daily limit, and $0.90 per additional 1,000 emails.
- Treat 75 eligible Tuesday recipients as the upgrade trigger, leaving headroom for magic links, retries, and operational messages.
- Configure a verified sending domain, SPF/DKIM/DMARC, unsubscribe links, bounce/complaint webhooks, and suppression before sending production email.

## Payment Cost and Operations

- Stripe Standard lists domestic online card processing at 2.9% + $0.30 per successful transaction, with no setup/monthly platform charge.
- Stripe Billing's pay-as-you-go price is currently an additional 0.7% of Billing volume.
- A $5 subscription therefore has an estimated $0.445 card-processing fee plus a $0.035 Billing fee and nets about $4.52 before hosting, email, tax, refunds, and disputes.
- Use Stripe-hosted Checkout and Customer Portal. Store only Stripe customer/subscription IDs and entitlement status; do not store card data.
- Verify and idempotently process Stripe webhooks for trial start/end, successful payment, payment failure, cancellation, and reactivation.

## Sources

- [Resend pricing](https://resend.com/pricing?volume=50000)
- [Resend account quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
- [Stripe pricing](https://stripe.com/pricing)
- [Stripe Billing pricing](https://stripe.com/billing/pricing)
