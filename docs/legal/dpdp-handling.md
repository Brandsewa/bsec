# DPDP Act 2023 Handling & Implementation Notes

> **Regulatory Compliance: Digital Personal Data Protection Act, 2023 (India)**  
> System: Brand Sewa E-Commerce Platform (`bsec`)  
> Status: Architecture & Implementation Notes  
> Date: September 2026

---

## 1. Statutory Background
The Digital Personal Data Protection Act, 2023 (DPDP Act) governs the processing of digital personal data within the territory of India. This document details how `bsec` software architecture complies with statutory principles.

## 2. Notice & Consent Architecture (Section 5 & 6)
- **Storefront Customer Consent:** Customers interacting with merchant storefronts are presented with clear, multilingual itemized consent notices prior to checkout or account registration.
- **Purpose Limitation:** Phone numbers and email addresses collected during checkout are restricted to order fulfillment, shipping notifications, and transactional communications unless explicit marketing opt-in (`acceptsMarketing: true`) is selected.

## 3. Data Fiduciary vs Data Processor Demarcation
- **Merchant as Data Fiduciary:** The merchant controls customer relationships, decides catalog pricing, and dictates return policies.
- **Brand Sewa as Data Processor:** Brand Sewa acts solely as the technical infrastructure provider processing transactions on the fiduciary's instructions.

## 4. Rights of Data Principals (Sections 11–14)
1. **Right to Access & Summary of Personal Data (Sec 11):**
   - Implemented via the **Full Store Export** job (`tenants.export` and customer export feature).
2. **Right to Correction & Erasure (Sec 12):**
   - Store admins can update customer details or delete customer records upon verified customer request.
   - Database purge completely cascades across memberships, customer addresses, carts, and drafts.
3. **Statutory Exception to Erasure (Tax & Audit Retention):**
   - Invoices (`orders_invoices`, `platform_invoices`) and ledger transactions are retained for **8 financial years** pursuant to Section 44 of the CGST Act 2017 and Section 128 of the Companies Act 2013, which supersedes general right to erasure under DPDP Act Section 12(3).

## 5. Security Safeguards & Audit Trails (Section 8(5))
- Multi-factor authentication mandatory for all platform staff.
- Row-Level Security (`FORCE ROW LEVEL SECURITY`) on all tenant tables in PostgreSQL 18.
- Immutable platform audit logging for every privileged operator interaction (`platform_audit_logs`).
- Zero plaintext storage of gateway secrets (`tenant_secrets` encrypted with AES-256-GCM).

## 6. Grievance Redressal Officer (Section 13)
Brand Sewa shall designate an Indian resident Grievance Redressal Officer whose contact details will be published in storefront and platform footers upon public launch.
