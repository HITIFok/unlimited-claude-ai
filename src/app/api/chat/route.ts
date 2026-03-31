import { NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

// Model name mapping for the Z.ai public API
const PUBLIC_MODEL_MAP: Record<string, string> = {
  'sz-opus-4-6': 'glm-4.6',
  'sz-sonnet-4-6': 'glm-4.6',
  'sz-opus-4-5': 'glm-4.5',
  'sz-sonnet-4-5': 'glm-4.5',
  'sz-sonnet-4': 'glm-4',
  'sz-opus-4': 'glm-4',
  'sz-3-7-sonnet': 'glm-4',
  'sz-3-5-sonnet': 'glm-4',
  'sz-3-5-haiku': 'glm-4-flash',
};

// Model name mapping for the Z.ai internal platform API
const INTERNAL_MODEL_MAP: Record<string, string> = {
  'sz-opus-4-6': 'claude-opus-4-6',
  'sz-sonnet-4-6': 'claude-sonnet-4-6',
  'sz-opus-4-5': 'claude-opus-4-5',
  'sz-sonnet-4-5': 'claude-sonnet-4-5',
  'sz-sonnet-4': 'claude-sonnet-4',
  'sz-opus-4': 'claude-opus-4',
  'sz-3-7-sonnet': 'claude-3-7-sonnet',
  'sz-3-5-sonnet': 'claude-3-5-sonnet',
  'sz-3-5-haiku': 'claude-3-5-haiku',
};

/**
 * Detect which mode we're running in:
 * - "platform": Inside the Z.ai platform (space.z.ai) — uses internal API + SDK
 * - "public": External deployment (Vercel, etc.) — uses public Z.ai API with API key
 */
async function detectMode(): Promise<'platform' | 'public'> {
  // Check if platform config exists at /etc/.z-ai-config (injected by Z.ai platform)
  try {
    const configStr = await readFile('/etc/.z-ai-config', 'utf-8');
    const config = JSON.parse(configStr);
    if (config.baseUrl && config.apiKey) return 'platform';
  } catch {}

  // Check if ZAI_PUBLIC_API_KEY env var is set (for Vercel)
  if (process.env.ZAI_PUBLIC_API_KEY) return 'public';

  // Default to public mode
  return 'public';
}

/**
 * Call the Z.ai public API (OpenAI-compatible) from external deployments like Vercel.
 * API docs: https://docs.z.ai/guides/overview/quick-start
 * Base URL: https://api.z.ai/api/paas/v4
 */
async function callPublicAPI(body: { messages: any[]; model: string; stream: boolean; max_tokens?: number; temperature?: number; thinking?: any }) {
  const apiKey = process.env.ZAI_PUBLIC_API_KEY;
  if (!apiKey) {
    throw new Error('ZAI_PUBLIC_API_KEY is not set. Get your API key from https://z.ai → API Keys management page.');
  }

  const baseUrl = process.env.ZAI_PUBLIC_BASE_URL || 'https://api.z.ai/api/paas/v4';
  const url = `${baseUrl}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Accept-Language': 'en-US,en',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Z.ai API error (${response.status}): ${errorBody}`);
  }

  return response;
}

/**
 * Call the internal Z.ai platform API using the SDK (only works inside Z.ai network).
 */
async function callPlatformAPI(body: { messages: any[]; model: string; stream: boolean; max_tokens?: number; temperature?: number; thinking?: any; vision?: boolean }) {
  // Dynamic import to avoid issues on platforms where the config doesn't exist
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();

  if (body.vision) {
    return zai.chat.completions.createVision(body);
  }
  return zai.chat.completions.create(body);
}

// Diagnostic endpoint
export async function GET() {
  const mode = await detectMode();

  const info: any = {
    status: 'ok',
    mode,
    advice: '',
  };

  if (mode === 'platform') {
    try {
      const configStr = await readFile('/etc/.z-ai-config', 'utf-8');
      const config = JSON.parse(configStr);
      info.platformConfig = {
        baseUrl: config.baseUrl ? 'SET' : 'NOT SET',
        apiKey: config.apiKey ? 'SET' : 'NOT SET',
        chatId: config.chatId ? `SET (${config.chatId.substring(0, 8)}...)` : 'NOT SET',
        token: config.token ? `SET (${config.token.substring(0, 15)}...)` : 'NOT SET',
      };
      info.advice = 'Running on Z.ai platform. Using internal API via SDK. Everything should work.';
    } catch (e: any) {
      info.advice = `Platform config error: ${e.message}`;
    }
  } else {
    info.envVars = {
      ZAI_PUBLIC_API_KEY: process.env.ZAI_PUBLIC_API_KEY ? 'SET' : 'NOT SET (required)',
      ZAI_PUBLIC_BASE_URL: process.env.ZAI_PUBLIC_BASE_URL || 'DEFAULT (https://api.z.ai/api/paas/v4)',
    };
    if (!process.env.ZAI_PUBLIC_API_KEY) {
      info.advice = 'ERROR: ZAI_PUBLIC_API_KEY is not set. Go to https://z.ai → API Keys → Create API Key, then add it as a Vercel environment variable.';
    } else {
      info.advice = 'Config looks OK. Using Z.ai public API. If chat still fails, verify your API key is valid at https://z.ai.';
    }
  }

  return new Response(JSON.stringify(info, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: NextRequest) {
  try {
    const mode = await detectMode();
    const body = await request.json();
    const { messages, model, system, max_tokens, temperature, thinking, vision } = body;

    // Build messages array
    const apiMessages: any[] = [];
    if (system) {
      apiMessages.push({ role: 'system', content: system });
    }
    if (messages && Array.isArray(messages)) {
      for (const msg of messages) {
        if (msg.attachments && msg.attachments.length > 0) {
          const imageAttachments = msg.attachments.filter((a: any) => a.isImage);
          if (imageAttachments.length > 0) {
            const content: any[] = [
              { type: 'text', text: msg.content || 'Please analyze these images.' },
              ...imageAttachments.map((att: any) => ({
                type: 'image_url',
                image_url: { url: att.base64 },
              })),
            ];
            apiMessages.push({ role: msg.role, content });
            continue;
          }
        }
        apiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    if (mode === 'platform') {
      // Use the internal Z.ai platform API via SDK
      const apiModel = model ? (INTERNAL_MODEL_MAP[model] || model) : 'claude-sonnet-4-6';
      const chatBody: any = {
        messages: apiMessages,
        stream: true,
        model: apiModel,
      };
      if (max_tokens) chatBody.max_tokens = max_tokens;
      if (temperature !== undefined) chatBody.temperature = temperature;
      chatBody.thinking = thinking || { type: 'disabled' };

      const result = await callPlatformAPI({ ...chatBody, vision });

      if (result instanceof ReadableStream) {
        const reader = result.getReader();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) { controller.close(); break; }
                controller.enqueue(value);
              }
            } catch (err: any) {
              console.error('[Super Z API] Platform stream error:', err.message);
              try { controller.close(); } catch {}
            }
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });

    } else {
      // Use the Z.ai public API (OpenAI-compatible) — for Vercel etc.
      const apiModel = model ? (PUBLIC_MODEL_MAP[model] || model) : 'glm-4.6';
      const chatBody: any = {
        messages: apiMessages,
        stream: true,
        model: apiModel,
      };
      if (max_tokens) chatBody.max_tokens = max_tokens;
      if (temperature !== undefined) chatBody.temperature = temperature;

      // The public API uses "thinking" mode differently
      if (thinking && thinking.type === 'enabled') {
        chatBody.thinking = { type: 'enabled' };
      }

      const response = await callPublicAPI(chatBody);

      // Stream the response back to the client
      if (response.body) {
        const stream = new ReadableStream({
          async start(controller) {
            const reader = response.body!.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) { controller.close(); break; }
                controller.enqueue(value);
              }
            } catch (err: any) {
              console.error('[Super Z API] Public stream error:', err.message);
              try { controller.close(); } catch {}
            }
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }

      const json = await response.json();
      return new Response(JSON.stringify(json), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error: any) {
    console.error('[Super Z API] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
