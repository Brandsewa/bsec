# Authorized Subprocessors

> **Platform Infrastructure & Vendor List**  
> System: Brand Sewa E-Commerce Platform (`bsec`)  
> Last Updated: September 2026

The following third-party service providers are utilized by Brand Sewa to deliver hosting, database, security, networking, and notification services for merchants and storefronts:

| Entity Name | Service Description | Processing Location | Data Categories Handled |
|---|---|---|---|
| **Hetzner Online GmbH** | Cloud compute & dedicated server hosting (Docker / PostgreSQL 18) | Falkenstein / Nuremberg, Germany (or Mumbai / Singapore if relocated) | Encrypted database storage, application logs, backups |
| **Cloudflare, Inc.** | Edge CDN, DDoS mitigation, DNS resolution, and Cloudflare R2 object storage | Global Edge Network / India Edge | HTTP network traffic, static media assets, IP addresses |
| **Razorpay Software Pvt. Ltd.** | Indian payment gateway integration (UPI, Netbanking, Cards) | India | Payment order references, transaction statuses, billing amounts (no raw card data on Brand Sewa servers) |
| **Shiprocket (BigFoot Retail Solutions Pvt. Ltd.)** | Shipping aggregation & carrier logistics integration | India | Delivery addresses, consignee names, telephone numbers, package dimensions |
| **Resend, Inc.** | Transactional email delivery (order confirmations, owner invites) | US / Global | Merchant emails, customer order notification emails |
| **Functional Software, Inc. (Sentry)** | Application exception tracking & crash diagnostics | Global / US | Anonymized application error stack traces, request URLs (PII scrubbed by SDK) |

---
Merchants will be provided 30 days prior written notice via the Super Admin / Store Admin announcement feed of any planned additions or replacements of subprocessors.
