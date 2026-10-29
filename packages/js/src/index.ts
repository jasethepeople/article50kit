export type DisclosureEvent = {
  eventType: "ai_interaction_disclosure" | "synthetic_content_label" | "deepfake_label" | "human_review";
  surface: string;
  locale?: string;
  notice: string;
  policyVersion?: string;
  contentSha256?: string;
  occurredAt?: string;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type Article50KitOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
};

export class Article50KitClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly request: FetchLike;

  constructor(options: Article50KitOptions) {
    if (!options.apiKey) throw new Error("apiKey is required");
    this.apiKey = options.apiKey;
    const browserOrigin = typeof location === "undefined" ? "" : location.origin;
    this.baseUrl = (options.baseUrl ?? browserOrigin).replace(/\/$/, "");
    if (!this.baseUrl) throw new Error("baseUrl is required outside a browser");
    this.request = options.fetch ?? fetch;
  }

  async recordDisclosure(event: DisclosureEvent) {
    return this.jsonRequest<{ id: string; receivedAt: string; eventHash: string; recorded: boolean; statement: string }>("/v1/events", {
      method: "POST",
      body: JSON.stringify(event),
    });
  }

  async listEvents() {
    return this.jsonRequest<{ events: Array<Record<string, unknown>>; limit: number; note: string }>("/v1/events");
  }

  async createEvidencePack(range: { from?: string; to?: string } = {}) {
    const response = await this.request(`${this.baseUrl}/v1/evidence-packs`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(range),
    });
    if (!response.ok) throw await this.apiError(response);
    return response.blob();
  }

  async signMedia(file: File, fetchOptions: { filename?: string } = {}) {
    const form = new FormData();
    form.set("file", file, fetchOptions.filename ?? file.name);
    const response = await this.request(`${this.baseUrl}/v1/mark`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
    if (!response.ok) throw await this.apiError(response);
    return { blob: await response.blob(), eventId: response.headers.get("X-Article50Kit-Event-Id"), eventHash: response.headers.get("X-Article50Kit-Event-Hash") };
  }

  private async jsonRequest<T>(path: string, init: RequestInit = {}) {
    const response = await this.request(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers({ "Content-Type": "application/json", ...init.headers }),
    });
    if (!response.ok) throw await this.apiError(response);
    return response.json() as Promise<T>;
  }

  private headers(extra: HeadersInit = {}) {
    const headers = new Headers(extra);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    return headers;
  }

  private async apiError(response: Response) {
    const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
    const error = new Error(body.error ?? `Article50Kit API returned ${response.status}`);
    Object.assign(error, { status: response.status, code: body.code });
    return error;
  }
}
