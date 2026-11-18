import { apiBase } from "./config.ts";

/** Content of the panel beside the sign-in form (GET /api/public/login-panel, edited in the Super Admin). */
export interface LoginPanel {
  heading: string;
  body: string;
  textColor: string;
  backgroundFrom: string;
  backgroundTo: string;
  imageUrl: string | null;
  verticalAlign?: "top" | "middle" | "bottom";
}

/** Shown until the saved panel arrives, and whenever it cannot be read, so the page never renders empty. Mirrors the server default (written as rgb() because app code may not use raw hex). */
export const DEFAULT_LOGIN_PANEL: LoginPanel = {
  heading: "Run your store from one place",
  body: "Manage products, orders and customers. Fast, simple and built for Indian stores.",
  textColor: "rgb(255 255 255)",
  backgroundFrom: "rgb(30 27 75)",
  backgroundTo: "rgb(67 56 202)",
  imageUrl: null,
  verticalAlign: "middle",
};

export async function fetchLoginPanel(): Promise<LoginPanel> {
  try {
    const res = await fetch(`${apiBase()}/api/public/login-panel`);
    if (!res.ok) return DEFAULT_LOGIN_PANEL;
    return (await res.json()) as LoginPanel;
  } catch {
    return DEFAULT_LOGIN_PANEL;
  }
}
