# Data Processing Agreement (DPA)

> **STATUS:** `[PENDING LEGAL REVIEW - NOT YET REVIEWED BY LEGAL COUNSEL]`  
> **Framework:** Digital Personal Data Protection Act, 2023 (DPDP Act, India) & GDPR Alignment  
> **Roles:** Merchant = Data Fiduciary (Controller) | Brand Sewa = Data Processor  
> **Date:** September 2026

---

## 1. Scope & Purpose of Processing
This Data Processing Agreement ("DPA") governs the processing of personal data by Brand Sewa on behalf of the Merchant in connection with the provision of the e-commerce platform services.

## 2. Roles of the Parties
1. **Merchant as Data Fiduciary:** The Merchant determines the purpose and means of collecting customer personal data (names, delivery addresses, phone numbers, email addresses, order histories).
2. **Brand Sewa as Data Processor:** Brand Sewa processes Merchant customer personal data solely on documented instructions from the Merchant, strictly for operating the hosted storefront, completing order checkouts, communicating notifications, and facilitating merchant fulfillments.

## 3. Technical & Organizational Security Measures (TOMs)
Brand Sewa implements industry-standard technical measures:
1. **Tenant Isolation:** PostgreSQL Row Level Security (`FORCE ROW LEVEL SECURITY`) and tenant context assertions (`withTenant`) strictly prevent cross-store data access.
2. **Cryptographic Protection:**
   - Sensitive third-party gateway credentials stored encrypted with AES-256-GCM using `TENANT_SECRETS_KEY`.
   - Passwords hashed using standard cryptographic algorithms (Argon2 / Scrypt).
   - In-transit encryption via TLS 1.3 / HTTPS across all public endpoints and custom domains.
3. **Privileged Access & Audit:**
   - Platform staff access to store administrative interfaces is restricted to time-boxed, consented support sessions with mandatory Multi-Factor Authentication (MFA).
   - Every mutation is recorded in immutable audit logs (`platform_audit_logs`).

## 4. Subprocessors
The Merchant authorizes Brand Sewa to engage third-party subprocessors for essential infrastructure operations. An up-to-date list is maintained at `docs/legal/subprocessors.md`. Brand Sewa imposes equivalent data protection obligations on all subprocessors.

## 5. Data Subject Rights & Grievance Redressal
Brand Sewa provides automated tooling within the Store Admin to allow Merchants to:
1. Access and export all customer records in standard formats.
2. Correct or update customer demographic and address records.
3. Handle customer erasure requests ("Right to be Forgotten") in compliance with applicable statutory retention requirements.

## 6. Security Incident Notification
In the event of a confirmed personal data breach affecting Merchant data, Brand Sewa shall notify the Merchant without undue delay (and in all events within statutory reporting windows prescribed by CERT-In and the Data Protection Board of India).

---
*Note: This agreement must be finalized with specialized data protection counsel prior to commercial contracts.*
