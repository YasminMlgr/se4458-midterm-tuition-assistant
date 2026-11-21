/**
 * REST client for the Tuition API. EVERY call goes to GATEWAY_URL (the API gateway) - the agent has no
 * direct route to the backend. The student's JWT is attached here and never shown to the LLM.
 */
export interface ApiResponse {
  status: number;
  body: any;
}

export interface TuitionApi {
  login(username: string, password: string): Promise<ApiResponse>;
  getTuition(token: string, studentNo: string, term?: string): Promise<ApiResponse>;
  payTuition(
    token: string,
    payload: { studentNo: string; term: string; amount: number; transactionId: string }
  ): Promise<ApiResponse>;
}

export class GatewayClient implements TuitionApi {
  constructor(
    private baseUrl = (process.env.GATEWAY_URL ?? "http://localhost:8000").replace(/\/$/, ""),
    private subscriptionKey = process.env.GATEWAY_SUBSCRIPTION_KEY
  ) {}

  private async call(method: string, path: string, token?: string, body?: unknown): Promise<ApiResponse> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (this.subscriptionKey) headers["Ocp-Apim-Subscription-Key"] = this.subscriptionKey;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { error: { code: "NON_JSON_RESPONSE", message: text.slice(0, 200) } };
      }
      return { status: res.status, body: parsed };
    } catch (err) {
      return { status: 0, body: { error: { code: "GATEWAY_UNREACHABLE", message: (err as Error).message } } };
    }
  }

  login(username: string, password: string) {
    return this.call("POST", "/api/v1/auth/login", undefined, { username, password });
  }
  getTuition(token: string, studentNo: string, term?: string) {
    const q = term ? `?term=${encodeURIComponent(term)}` : "";
    return this.call("GET", `/api/v1/tuition/${encodeURIComponent(studentNo)}${q}`, token);
  }
  payTuition(token: string, payload: { studentNo: string; term: string; amount: number; transactionId: string }) {
    return this.call("POST", "/api/v1/tuition/payments", token, payload);
  }
}

/** Reads the (unverified) payload of a JWT. Verification is the API's job; the agent only needs the claims for display. */
export function decodeJwtClaims(token: string): { role?: string; studentNo?: string; sub?: string } {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}
