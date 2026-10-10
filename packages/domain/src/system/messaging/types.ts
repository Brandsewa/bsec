export type MessageChannel = "sms" | "whatsapp";

export interface ChannelSendInput {
  to: string; // Destination phone number
  template: string; // Logical template name
  variables?: Record<string, string> | undefined; // Dynamic template merge variables
  tenantId?: string | null | undefined;
}

export interface ChannelSendResult {
  ok: boolean;
  providerMessageId?: string | null | undefined;
  error?: string | null | undefined;
  maskedRecipient: string; // Masked phone number (last 4 digits only)
}

export interface ChannelTestInput {
  to: string; // Destination phone number for test dispatch
}

export interface ChannelTestResult {
  ok: boolean;
  providerMessageId?: string | null | undefined;
  error?: string | null | undefined;
}

export interface MessageChannelAdapter {
  readonly channel: MessageChannel;
  readonly provider: string;

  /**
   * Dispatches a transactional message via this provider adapter.
   */
  send(input: ChannelSendInput): Promise<ChannelSendResult>;

  /**
   * Diagnostic test verification to validate credentials and endpoint reachability.
   */
  test(input: ChannelTestInput): Promise<ChannelTestResult>;
}
