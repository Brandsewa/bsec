import type {
  CancelShipmentResult,
  CreateShipmentInput,
  CreateShipmentResult,
  LabelResult,
  RateEstimateInput,
  ServiceabilityResult,
  ShippingProvider,
  TenantContext,
  TrackingResult,
  VerifiedShippingWebhookEvent,
} from "../types.ts";

/**
 * ManualShippingProvider (PLAN §11.7 Kill Switch fallback).
 * When Shiprocket integration is switched off or unavailable, manual fulfillment
 * allows entering custom tracking number / carrier directly without blocking store operations.
 */
export class ManualShippingProvider implements ShippingProvider {
  readonly name = "manual";

  async checkServiceability(
    _ctx: TenantContext,
    input: RateEstimateInput,
  ): Promise<ServiceabilityResult> {
    return {
      serviceable: true,
      pickupPincode: input.pickupPincode,
      deliveryPincode: input.deliveryPincode,
      rates: [
        {
          courierId: "manual-standard",
          courierName: "Standard Delivery",
          ratePaise: 0,
          estimatedDays: "3-5 days",
          codAvailable: true,
          mode: "surface",
        },
      ],
    };
  }

  async createShipment(
    _ctx: TenantContext,
    input: CreateShipmentInput,
  ): Promise<CreateShipmentResult> {
    const shipmentId = `manual_ship_${Date.now()}`;
    return {
      providerShipmentId: shipmentId,
      providerOrderId: input.orderNumber,
      status: "created",
      courierName: "Manual Courier",
    };
  }

  async generateLabel(
    _ctx: TenantContext,
    shipmentId: string,
  ): Promise<LabelResult> {
    return {
      shipmentId,
      labelUrl: "",
      labelHtml: `<div>Manual Shipment Label: ${shipmentId}</div>`,
    };
  }

  async trackShipment(
    _ctx: TenantContext,
    awbOrShipmentId: string,
  ): Promise<TrackingResult> {
    return {
      shipmentId: awbOrShipmentId,
      awb: awbOrShipmentId,
      currentStatus: "in_transit",
      carrier: "Manual",
      activities: [
        {
          date: new Date().toISOString(),
          status: "in_transit",
          activity: "Package dispatched manually",
          location: "Warehouse",
        },
      ],
    };
  }

  async cancelShipment(
    _ctx: TenantContext,
    _shipmentId: string,
  ): Promise<CancelShipmentResult> {
    return {
      success: true,
      message: "Manual shipment cancelled",
    };
  }

  async verifyWebhook(
    _headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
  ): Promise<VerifiedShippingWebhookEvent> {
    const raw = typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString("utf8"));
    return {
      isValid: true,
      provider: "manual",
      eventId: `manual_evt_${Date.now()}`,
      eventType: "tracking.update",
      currentStatus: raw.status ?? "in_transit",
      occurredAt: new Date(),
      rawPayload: raw,
    };
  }
}
