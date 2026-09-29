import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CancelShipmentResult,
  CreateShipmentInput,
  CreateShipmentResult,
  LabelResult,
  RateEstimateInput,
  ServiceabilityResult,
  ShippingProvider,
  ShippingRateOption,
  TenantContext,
  TrackingActivity,
  TrackingResult,
  VerifiedShippingWebhookEvent,
} from "../types.ts";

export interface ShiprocketCredentials {
  email?: string | undefined;
  password?: string | undefined;
  apiToken?: string | undefined;
  tokenExpiresAt?: number | undefined;
  webhookSecret?: string | undefined;
}

export interface ShiprocketHttpFetch {
  (url: string, init?: RequestInit): Promise<Response>;
}

export interface ShiprocketProviderOptions {
  credentials?: ShiprocketCredentials | undefined;
  fetchFn?: ShiprocketHttpFetch | undefined;
  baseUrl?: string | undefined;
}

/**
 * Production Shiprocket API Provider (PLAN §11.7, ADR-008).
 * Handles token generation/caching, serviceability checks, custom order creation,
 * label retrieval, tracking updates, and webhook HMAC validation.
 */
export class ShiprocketProvider implements ShippingProvider {
  readonly name = "shiprocket";
  private email?: string | undefined;
  private password?: string | undefined;
  private apiToken?: string | undefined;
  private tokenExpiresAt?: number | undefined;
  private webhookSecret?: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchFn: ShiprocketHttpFetch;

  constructor(opts: ShiprocketProviderOptions = {}) {
    this.email = opts.credentials?.email;
    this.password = opts.credentials?.password;
    this.apiToken = opts.credentials?.apiToken;
    this.tokenExpiresAt = opts.credentials?.tokenExpiresAt;
    this.webhookSecret = opts.credentials?.webhookSecret;
    this.baseUrl = opts.baseUrl ?? "https://apiv2.shiprocket.in/v1/external";
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  /**
   * Acquires or returns cached Shiprocket authentication bearer token.
   * If credentials are not configured, throws an informative error.
   */
  async getAuthToken(): Promise<string> {
    if (this.apiToken && (!this.tokenExpiresAt || this.tokenExpiresAt > Date.now() + 60_000)) {
      return this.apiToken;
    }

    if (!this.email || !this.password) {
      throw new Error(
        "Shiprocket credentials (email and password) are not configured. Enable manual shipping or configure credentials in store settings.",
      );
    }

    const res = await this.fetchFn(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Shiprocket auth failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { token: string };
    if (!data.token) {
      throw new Error("Shiprocket auth response missing token");
    }

    this.apiToken = data.token;
    // Cache for 9 days (Shiprocket tokens typically last 10 days)
    this.tokenExpiresAt = Date.now() + 9 * 24 * 3600 * 1000;
    return this.apiToken;
  }

  async checkServiceability(
    _ctx: TenantContext,
    input: RateEstimateInput,
  ): Promise<ServiceabilityResult> {
    const token = await this.getAuthToken();
    const weightKg = (input.weightGrams / 1000).toFixed(2);
    const codFlag = input.cod ? "1" : "0";

    const url = new URL(`${this.baseUrl}/courier/serviceability/`);
    url.searchParams.set("pickup_postcode", input.pickupPincode);
    url.searchParams.set("delivery_postcode", input.deliveryPincode);
    url.searchParams.set("weight", weightKg);
    url.searchParams.set("cod", codFlag);
    if (input.declaredValue) {
      url.searchParams.set("declared_value", (input.declaredValue / 100).toFixed(2));
    }

    const res = await this.fetchFn(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Shiprocket serviceability check failed: ${errText}`);
    }

    const data = (await res.json()) as {
      status?: number;
      data?: {
        available_courier_companies?: Array<{
          courier_company_id: number | string;
          courier_name: string;
          rate: number;
          etd: string;
          cod: number;
          mode?: string;
        }>;
      };
    };

    const companies = data?.data?.available_courier_companies ?? [];
    const rates: ShippingRateOption[] = companies.map((c) => ({
      courierId: String(c.courier_company_id),
      courierName: c.courier_name,
      ratePaise: Math.round(c.rate * 100),
      estimatedDays: c.etd,
      codAvailable: c.cod === 1,
      mode: c.mode,
    }));

    return {
      serviceable: rates.length > 0,
      pickupPincode: input.pickupPincode,
      deliveryPincode: input.deliveryPincode,
      rates,
    };
  }

  async createShipment(
    _ctx: TenantContext,
    input: CreateShipmentInput,
  ): Promise<CreateShipmentResult> {
    const token = await this.getAuthToken();

    const orderPayload = {
      order_id: input.orderNumber,
      order_date: input.orderDate ?? new Date().toISOString().slice(0, 19).replace("T", " "),
      pickup_location: input.pickupLocation,
      billing_customer_name: input.deliveryAddress.name,
      billing_last_name: "",
      billing_address: input.deliveryAddress.addressLine1,
      billing_address_2: input.deliveryAddress.addressLine2 ?? "",
      billing_city: input.deliveryAddress.city,
      billing_pincode: input.deliveryAddress.pincode,
      billing_state: input.deliveryAddress.state,
      billing_country: input.deliveryAddress.country ?? "India",
      billing_email: "orders@customer.local",
      billing_phone: input.deliveryAddress.phone,
      shipping_is_billing: true,
      order_items: input.items.map((it) => ({
        name: it.name,
        sku: it.sku ?? "DEFAULT",
        units: it.units,
        selling_price: (it.sellingPrice / 100).toFixed(2),
        discount: it.discount ? (it.discount / 100).toFixed(2) : "0",
        hsn: it.hsn ?? "",
      })),
      payment_method: input.paymentMethod === "cod" ? "COD" : "Prepaid",
      shipping_charges: (input.shippingFee / 100).toFixed(2),
      total_discount: "0",
      sub_total: (input.total / 100).toFixed(2),
      length: input.lengthCm ?? 10,
      breadth: input.breadthCm ?? 10,
      height: input.heightCm ?? 10,
      weight: (input.weightGrams / 1000).toFixed(2),
    };

    const res = await this.fetchFn(`${this.baseUrl}/orders/create/adhoc`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderPayload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Shiprocket order creation failed: ${errText}`);
    }

    const data = (await res.json()) as {
      order_id?: number | string;
      shipment_id?: number | string;
      awb_code?: string;
      courier_name?: string;
      status?: string;
      routing_code?: string;
    };

    return {
      providerShipmentId: String(data.shipment_id ?? data.order_id ?? ""),
      providerOrderId: String(data.order_id ?? input.orderNumber),
      awb: data.awb_code,
      courierName: data.courier_name,
      status: "created",
      routingCode: data.routing_code,
      rawResponse: data as Record<string, unknown>,
    };
  }

  async generateLabel(
    _ctx: TenantContext,
    shipmentId: string,
  ): Promise<LabelResult> {
    const token = await this.getAuthToken();

    const res = await this.fetchFn(`${this.baseUrl}/courier/generate/label`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ shipment_id: [shipmentId] }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Shiprocket label generation failed: ${errText}`);
    }

    const data = (await res.json()) as {
      label_created?: number;
      label_url?: string;
    };

    return {
      shipmentId,
      labelUrl: data.label_url ?? "",
    };
  }

  async trackShipment(
    _ctx: TenantContext,
    awbOrShipmentId: string,
  ): Promise<TrackingResult> {
    const token = await this.getAuthToken();

    const res = await this.fetchFn(`${this.baseUrl}/courier/track/awb/${awbOrShipmentId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Shiprocket tracking failed: ${errText}`);
    }

    const data = (await res.json()) as {
      tracking_data?: {
        track_status?: number;
        shipment_status?: number;
        shipment_track?: Array<{
          id: number;
          awb_code: string;
          current_status: string;
          courier_name: string;
          delivered_date?: string;
        }>;
        shipment_track_activities?: Array<{
          date: string;
          status: string;
          activity: string;
          location: string;
          "sr-status"?: string;
        }>;
      };
    };

    const track = data.tracking_data?.shipment_track?.[0];
    const rawActivities = data.tracking_data?.shipment_track_activities ?? [];

    const activities: TrackingActivity[] = rawActivities.map((a) => ({
      date: a.date,
      status: a.status,
      activity: a.activity,
      location: a.location,
      srStatus: a["sr-status"],
    }));

    return {
      awb: track?.awb_code ?? awbOrShipmentId,
      currentStatus: track?.current_status ?? "in_transit",
      carrier: track?.courier_name ?? "Shiprocket",
      deliveredDate: track?.delivered_date,
      activities,
    };
  }

  async cancelShipment(
    _ctx: TenantContext,
    _shipmentId: string,
    awb?: string,
  ): Promise<CancelShipmentResult> {
    const token = await this.getAuthToken();

    const res = await this.fetchFn(`${this.baseUrl}/orders/cancel/shipment/awbs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ awbs: [awb] }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, message: errText };
    }

    return { success: true };
  }

  /**
   * Verifies Shiprocket tracking webhook HMAC or signature token.
   */
  async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
  ): Promise<VerifiedShippingWebhookEvent> {
    const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(bodyStr);
    } catch {
      return {
        isValid: false,
        provider: "shiprocket",
        eventId: `unknown_${Date.now()}`,
        eventType: "unknown",
        currentStatus: "unknown",
        occurredAt: new Date(),
        rawPayload: {},
      };
    }

    // Shiprocket sends custom token in x-api-key or HMAC signature in x-shiprocket-signature
    const providedSig =
      (headers["x-shiprocket-signature"] as string | undefined) ||
      (headers["x-api-key"] as string | undefined);

    let isValid = false;
    if (this.webhookSecret && providedSig) {
      const computedHmac = createHmac("sha256", this.webhookSecret).update(bodyStr).digest("hex");
      try {
        const computedBuf = Buffer.from(computedHmac, "utf8");
        const providedBuf = Buffer.from(providedSig, "utf8");
        if (computedBuf.length === providedBuf.length && timingSafeEqual(computedBuf, providedBuf)) {
          isValid = true;
        } else if (providedSig === this.webhookSecret) {
          // Token comparison
          isValid = true;
        }
      } catch {
        isValid = false;
      }
    } else if (!this.webhookSecret) {
      // If store hasn't configured a secret, mark unverified
      isValid = false;
    }

    const eventId = String(parsed.awb ?? parsed.shipment_id ?? parsed.order_id ?? `evt_${Date.now()}`);
    const currentStatus = String(parsed.current_status ?? parsed.status ?? "in_transit").toLowerCase();

    let eventType = "shipment.in_transit";
    if (currentStatus.includes("delivered")) {
      eventType = "shipment.delivered";
    } else if (currentStatus.includes("rto")) {
      eventType = "shipment.rto";
    } else if (currentStatus.includes("out for delivery")) {
      eventType = "shipment.out_for_delivery";
    } else if (currentStatus.includes("pickup") || currentStatus.includes("picked")) {
      eventType = "shipment.picked_up";
    }

    return {
      isValid,
      provider: "shiprocket",
      eventId,
      eventType,
      shipmentId: parsed.shipment_id ? String(parsed.shipment_id) : undefined,
      awb: parsed.awb ? String(parsed.awb) : undefined,
      currentStatus,
      location: typeof parsed.current_location === "string" ? parsed.current_location : undefined,
      message: typeof parsed.scans === "string" ? parsed.scans : undefined,
      occurredAt: new Date(),
      rawPayload: parsed,
    };
  }
}
