import { PaymentResult } from "../types";

const PAYPAL_CLIENT_ID = "AYy70D-17yXeQstNhCE6rqzF2kHmE_JIovu0Hvualqj056Mn6na4qGlqrrwS5JuUrvd0NmOJdi-GLxlc";

let loadPromise: Promise<void> | null = null;

export const loadPayPalSDK = (): Promise<void> => {
  if ((window as any).paypal) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=NZD&locale=en_NZ&intent=capture&disable-funding=credit,card`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load PayPal SDK"));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
};

export const verifyPayment = async (orderID: string): Promise<PaymentResult> => {
  try {
    const response = await fetch("/api/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderID }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error ?? `Server error: ${response.status}`);
    }

    return (await response.json()) as PaymentResult;
  } catch (error: any) {
    console.error("Payment verification failed:", error);
    return {
      verified: false,
      error: error.message ?? "Failed to verify payment. Please contact support.",
    };
  }
};
