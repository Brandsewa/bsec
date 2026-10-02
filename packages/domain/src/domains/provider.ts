interface CfCustomHostnameApiResponse {
  result: {
    id: string;
    hostname: string;
    status: string;
    ssl?: { status?: string };
    ownership_verification?: { name: string; value: string };
    verification_errors?: string[];
  };
}

export interface CustomHostnameResult {
  providerHostnameId: string | null;
  hostname: string;
  cnameTarget?: string | undefined;
  txtVerification?: {
    name: string;
    value: string;
  } | undefined;
  status: "requested" | "awaiting_dns" | "verifying" | "ssl_pending" | "active" | "failed";
  sslStatus: "not_configured" | "initializing" | "pending_validation" | "pending_issuance" | "active" | "failed";
}

export interface CustomHostnameStatusResult {
  providerHostnameId: string;
  hostname: string;
  status: "requested" | "awaiting_dns" | "verifying" | "ssl_pending" | "active" | "failed";
  sslStatus: "not_configured" | "initializing" | "pending_validation" | "pending_issuance" | "active" | "failed";
  verificationErrors?: string[];
}

export interface CustomDomainProvider {
  isConfigured?(): boolean;
  createCustomHostname(
    hostname: string,
    opts?: { prevalidate?: boolean },
  ): Promise<CustomHostnameResult>;
  getCustomHostnameStatus(providerHostnameId: string): Promise<CustomHostnameStatusResult>;
  deleteCustomHostname(providerHostnameId: string): Promise<{ deleted: boolean }>;
}

/**
 * Cloudflare for SaaS Custom Hostname Provider Adapter (PLAN §8, ADR-007, ADR-017).
 * Interacts with Cloudflare API v4 Custom Hostnames endpoint.
 * When API credentials are not set, operates in honest unconfigured mode without fabricating live success.
 */
export class CloudflareCustomDomainProvider implements CustomDomainProvider {
  private apiToken: string | null;
  private zoneId: string | null;
  // CNAME target customers point their domain at; must exist as a hostname in the Cloudflare zone.
  private readonly fallbackCname =
    process.env.CUSTOM_DOMAIN_CNAME_TARGET?.trim() || `stores.${process.env.PLATFORM_DOMAIN?.trim() || "bcom.si"}`;

  constructor(opts?: { apiToken?: string; zoneId?: string }) {
    this.apiToken = opts?.apiToken ?? process.env.CLOUDFLARE_API_TOKEN ?? null;
    this.zoneId = opts?.zoneId ?? process.env.CLOUDFLARE_ZONE_ID ?? null;
  }

  isConfigured(): boolean {
    return Boolean(this.apiToken && this.zoneId);
  }

  async createCustomHostname(
    hostname: string,
    opts?: { prevalidate?: boolean },
  ): Promise<CustomHostnameResult> {
    if (!this.isConfigured()) {
      return {
        providerHostnameId: null,
        hostname,
        cnameTarget: undefined,
        status: "requested",
        sslStatus: "not_configured",
      };
    }

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/custom_hostnames`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hostname,
          ssl: {
            method: opts?.prevalidate ? "txt" : "http",
            type: "dv",
            settings: {
              min_tls_version: "1.2",
            },
          },
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Cloudflare custom hostname creation failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as CfCustomHostnameApiResponse;
    const result = data.result;

    const txtRecord = result?.ownership_verification
      ? {
          name: result.ownership_verification.name,
          value: result.ownership_verification.value,
        }
      : undefined;

    return {
      providerHostnameId: result.id,
      hostname: result.hostname,
      cnameTarget: this.fallbackCname,
      ...(txtRecord ? { txtVerification: txtRecord } : {}),
      status: this.mapCloudflareStatus(result.status),
      sslStatus: this.mapCloudflareSslStatus(result.ssl?.status),
    };
  }

  async getCustomHostnameStatus(providerHostnameId: string): Promise<CustomHostnameStatusResult> {
    if (!this.isConfigured() || !providerHostnameId) {
      return {
        providerHostnameId: providerHostnameId || "",
        hostname: "",
        status: "requested",
        sslStatus: "not_configured",
      };
    }

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/custom_hostnames/${providerHostnameId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Cloudflare custom hostname status failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as CfCustomHostnameApiResponse;
    const result = data.result;

    return {
      providerHostnameId: result.id,
      hostname: result.hostname,
      status: this.mapCloudflareStatus(result.status),
      sslStatus: this.mapCloudflareSslStatus(result.ssl?.status),
      verificationErrors: result.verification_errors ?? [],
    };
  }

  async deleteCustomHostname(providerHostnameId: string): Promise<{ deleted: boolean }> {
    if (!this.isConfigured()) {
      return { deleted: true };
    }

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/custom_hostnames/${providerHostnameId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!res.ok && res.status !== 404) {
      const errText = await res.text();
      throw new Error(`Cloudflare custom hostname deletion failed (${res.status}): ${errText}`);
    }

    return { deleted: true };
  }

  private mapCloudflareStatus(
    cfStatus?: string,
  ): "awaiting_dns" | "verifying" | "ssl_pending" | "active" | "failed" {
    switch (cfStatus) {
      case "active":
        return "active";
      case "pending":
        return "verifying";
      case "blocked":
      case "moved":
        return "failed";
      default:
        return "awaiting_dns";
    }
  }

  private mapCloudflareSslStatus(
    cfSsl?: string,
  ): "initializing" | "pending_validation" | "pending_issuance" | "active" | "failed" {
    switch (cfSsl) {
      case "active":
        return "active";
      case "pending_validation":
        return "pending_validation";
      case "pending_issuance":
      case "pending_deployment":
        return "pending_issuance";
      case "initializing":
        return "initializing";
      default:
        return "pending_validation";
    }
  }
}
