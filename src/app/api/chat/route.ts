import { NextRequest } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

// Translate internal Super Z model names to API model names
const MODEL_MAP: Record<string, string> = {
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

let zaiInstance: any = null;

/**
 * Create ZAI instance directly from env vars (no filesystem dependency).
 * On the Z.ai platform, .z-ai-config provides baseUrl/token automatically.
 * On Vercel, all values must come from environment variables.
 */
function buildConfig() {
  return {
    baseUrl: process.env.ZAI_BASE_URL || '',
    apiKey: process.env.ZAI_API_KEY || '',
    chatId: process.env.ZAI_CHAT_ID || '',
    token: process.env.ZAI_TOKEN || '',
    userId: process.env.ZAI_USER_ID || '',
  };
}

async function getZAI() {
  if (zaiInstance) return zaiInstance;
  const config = buildConfig();
  zaiInstance = new ZAI(config);
  return zaiInstance;
}

// Diagnostic endpoint
export async function GET() {
  const config = buildConfig();

  return new Response(JSON.stringify({
    status: 'ok',
    config: {
      baseUrl: config.baseUrl || 'NOT SET (required)',
      apiKey: config.apiKey ? `SET (${config.apiKey.substring(0, 6)}...)` : 'NOT SET (required)',
      chatId: config.chatId ? `SET (${config.chatId.substring(0, 8)}...)` : 'NOT SET',
      token: config.token ? `SET (${config.token.substring(0, 15)}...)` : 'NOT SET',
      userId: config.userId ? `SET (${config.userId.substring(0, 8)}...)` : 'NOT SET',
    },
    envVars: {
      ZAI_BASE_URL: process.env.ZAI_BASE_URL ? 'SET' : 'NOT SET',
      ZAI_API_KEY: process.env.ZAI_API_KEY ? 'SET' : 'NOT SET',
      ZAI_CHAT_ID: process.env.ZAI_CHAT_ID ? 'SET' : 'NOT SET',
      ZAI_TOKEN: process.env.ZAI_TOKEN ? 'SET' : 'NOT SET',
      ZAI_USER_ID: process.env.ZAI_USER_ID ? 'SET' : 'NOT SET',
    },
    advice: !config.baseUrl
      ? 'ERROR: ZAI_BASE_URL is not set. On Vercel, add it as an environment variable (e.g. https://z.ai/api/v1).'
      : !config.apiKey
      ? 'ERROR: ZAI_API_KEY is not set. On Vercel, add it as an environment variable.'
      : 'Config looks OK. If chat still fails, check that the API server is reachable and credentials are valid.',
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: NextRequest) {
  try {
    const config = buildConfig();

    if (!config.baseUrl) {
      return new Response(
        JSON.stringify({
          error: 'ZAI_BASE_URL is not configured. On Vercel, set the ZAI_BASE_URL environment variable to the public API URL (e.g. https://z.ai/api/v1).',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!config.apiKey) {
      return new Response(
        JSON.stringify({
          error: 'ZAI_API_KEY is not configured. On Vercel, set the ZAI_API_KEY environment variable.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!config.chatId) {
      return new Response(
        JSON.stringify({
          error: 'ZAI_CHAT_ID is not configured. On Vercel, set the ZAI_CHAT_ID environment variable.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { messages, model, system, max_tokens, temperature, thinking, vision } = body;

    const zai = await getZAI();

    // Build API messages
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

    const apiModel = model ? (MODEL_MAP[model] || model) : 'claude-sonnet-4-6';

    const chatBody: any = {
      messages: apiMessages,
      stream: true,
      model: apiModel,
    };
    if (max_tokens) chatBody.max_tokens = max_tokens;
    if (temperature !== undefined) chatBody.temperature = temperature;
    chatBody.thinking = thinking || { type: 'disabled' };

    let result;
    if (vision) {
      result = await zai.chat.completions.createVision(chatBody);
    } else {
      result = await zai.chat.completions.create(chatBody);
    }

    // Stream the response back
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
            console.error('[Super Z API] Stream error:', err.message);
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
  } catch (error: any) {
    console.error('[Super Z API] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
