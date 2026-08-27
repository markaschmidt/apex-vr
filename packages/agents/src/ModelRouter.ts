import { z } from "zod";

/**
 * Thin provider interface so Spatium (or any host) can swap OpenRouter,
 * OpenAI, local Ollama, or a Jac byLLM endpoint without rewriting VR code.
 */
export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ModelRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});
export type ModelRequest = z.infer<typeof ModelRequestSchema>;

export interface ModelResponse {
  text: string;
  model: string;
  raw?: unknown;
}

export interface ModelProvider {
  readonly id: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface OpenRouterOptions {
  apiKey: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}

/** OpenRouter-compatible chat completions provider. */
export class OpenRouterProvider implements ModelProvider {
  readonly id = "openrouter";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: OpenRouterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://openrouter.ai/api/v1";
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const body = ModelRequestSchema.parse(request);
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...this.defaultHeaders,
      },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        temperature: body.temperature,
        max_tokens: body.maxTokens,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${detail}`);
    }

    const raw = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = raw.choices?.[0]?.message?.content?.trim() ?? "";
    return { text, model: raw.model ?? body.model, raw };
  }
}

export class ModelRouter {
  private readonly providers = new Map<string, ModelProvider>();
  private defaultProviderId?: string;

  register(provider: ModelProvider, asDefault = false): void {
    this.providers.set(provider.id, provider);
    if (asDefault || !this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
  }

  async complete(
    request: ModelRequest,
    providerId?: string,
  ): Promise<ModelResponse> {
    const id = providerId ?? this.defaultProviderId;
    if (!id) throw new Error("No model provider registered.");
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Unknown model provider: ${id}`);
    return provider.complete(request);
  }
}
