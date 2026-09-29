/**
 * Shipping Provider interfaces and domain types (PLAN §11.7, ADR-008).
 * Provider-neutral abstraction implemented by ShiprocketProvider, ManualShippingProvider, etc.
 */

export interface TenantContext {
  tenantId: string;
  storeStatus?: string | undefined;
  actor?: { type: "system" | "customer" | "staff"; id?: string | undefined } | undefined;
  roles?: readonly string[] | undefined;
  permissions?: readonly string[] | undefined;
  requestId?: string | undefined;
}

export interface AddressPayload {
  name: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  city: string;
  state: string;
  pincode: string;
  country?: string | undefined;
}

export interface RateEstimateInput {
  pickupPincode: string;
  deliveryPincode: string;
  weightGrams: number;
  cod: boolean;
  declaredValue?: number | undefined; // in paise
}

export interface ShippingRateOption {
  courierId: string;
  courierName: string;
  ratePaise: number;
  estimatedDays: number | string;
  codAvailable: boolean;
  mode?: "air" | "surface" | string | undefined;
}

export interface ServiceabilityResult {
  serviceable: boolean;
  pickupPincode: string;
  deliveryPincode: string;
  rates: ShippingRateOption[];
}

export interface CreateShipmentItem {
  name: string;
  sku?: string | undefined;
  units: number;
  sellingPrice: number; // in paise or rupees
  discount?: number | undefined;
  hsn?: string | undefined;
}

export interface CreateShipmentInput {
  orderId: string;
  orderNumber: string;
  orderDate?: string | undefined;
  pickupLocation: string; // name registered in Shiprocket/locations
  pickupAddress?: AddressPayload | undefined;
  deliveryAddress: AddressPayload;
  items: CreateShipmentItem[];
  subtotal: number; // paise
  shippingFee: number; // paise
  total: number; // paise
  paymentMethod: "cod" | "prepaid";
  weightGrams: number;
  lengthCm?: number | undefined;
  breadthCm?: number | undefined;
  heightCm?: number | undefined;
}

export interface CreateShipmentResult {
  providerShipmentId: string;
  providerOrderId: string;
  awb?: string | undefined;
  courierName?: string | undefined;
  status: "created" | "label_created" | "manifest_generated" | "failed";
  labelUrl?: string | undefined;
  manifestUrl?: string | undefined;
  routingCode?: string | undefined;
  rawResponse?: Record<string, unknown> | undefined;
}

export interface LabelResult {
  shipmentId: string;
  labelUrl: string;
  labelHtml?: string | undefined;
}

export interface TrackingActivity {
  date: string;
  status: string;
  activity: string;
  location: string;
  srStatus?: string | undefined;
}

export interface TrackingResult {
  shipmentId?: string | undefined;
  awb: string;
  currentStatus: string;
  carrier: string;
  deliveredDate?: string | undefined;
  activities: TrackingActivity[];
}

export interface CancelShipmentResult {
  success: boolean;
  message?: string | undefined;
}

export interface VerifiedShippingWebhookEvent {
  isValid: boolean;
  provider: string;
  eventId: string;
  eventType: string; // e.g. "shipment.in_transit", "shipment.delivered", "shipment.rto"
  shipmentId?: string | undefined;
  awb?: string | undefined;
  currentStatus: string;
  location?: string | undefined;
  message?: string | undefined;
  occurredAt: Date;
  rawPayload: Record<string, unknown>;
}

/**
 * ShippingProvider interface mirroring PaymentProvider (PLAN §11.7, ADR-008).
 */
export interface ShippingProvider {
  readonly name: string;
  checkServiceability(ctx: TenantContext, input: RateEstimateInput): Promise<ServiceabilityResult>;
  createShipment(ctx: TenantContext, input: CreateShipmentInput): Promise<CreateShipmentResult>;
  generateLabel(ctx: TenantContext, shipmentId: string): Promise<LabelResult>;
  trackShipment(ctx: TenantContext, awbOrShipmentId: string): Promise<TrackingResult>;
  cancelShipment(ctx: TenantContext, shipmentId: string, awb?: string): Promise<CancelShipmentResult>;
  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer,
  ): Promise<VerifiedShippingWebhookEvent>;
}
