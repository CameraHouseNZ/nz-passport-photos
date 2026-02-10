import { ComplianceResult } from "../types";

export const checkPassportCompliance = async (base64Image: string): Promise<ComplianceResult> => {
  try {
    const response = await fetch('/api/check-compliance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error ?? `Server error: ${response.status}`);
    }

    return (await response.json()) as ComplianceResult;
  } catch (error) {
    console.error("Compliance check failed:", error);
    return {
      passed: false,
      score: 0,
      checks: {
        background: "Error",
        headSize: "Error",
        expression: "Error",
        lighting: "Error",
        sharpness: "Error"
      },
      feedback: "Failed to connect to AI service for validation. Please try again."
    };
  }
};
