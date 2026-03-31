import { NextRequest } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

// Allow larger request bodies for vision/PDF uploads (up to 6MB)
export const maxDuration = 120;
export const runtime = 'nodejs';

// ──────────────────────────────────────────────
// Z.ai Proxy URL — used on Vercel (no internal API access)
// On Z.ai platform: SDK is used directly (free, fast)
// On Vercel: requests are proxied to the Z.ai space
// ──────────────────────────────────────────────
const ZAI_PROXY_URL = 'https://preview-chat-1fe5ba1f-5e1b-487c-9022-b3c2f9413bf7.space.z.ai';

const isVercel = !!process.env.VERCEL;

// Model name mapping (Super Z display names → internal API names)
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

// ──────────────────────────────────────────────
// MODE: Proxy to Z.ai space (Vercel)
// ──────────────────────────────────────────────
async function proxyToZAI(body: Record<string, any>) {
  const res = await fetch(`${ZAI_PROXY_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Vercel default timeout is 10s for Hobby, 60s for Pro — give enough time for vision
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Z.ai proxy error ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';

  // If streaming response, pipe it through
  if (contentType.includes('text/event-stream') && res.body) {
    return new Response(res.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // Non-streaming JSON response
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// ──────────────────────────────────────────────
// MODE: Direct SDK (Z.ai platform)
// ──────────────────────────────────────────────
let zaiInstance: any = null;

async function getZAI() {
  if (zaiInstance) return zaiInstance;
  zaiInstance = await ZAI.create();
  return zaiInstance;
}

function streamResponse(result: ReadableStream) {
  const reader = result.getReader();
  return new Response(new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { controller.close(); break; }
          controller.enqueue(value);
        }
      } catch (err: any) {
        console.error('[Super Z] Stream error:', err.message);
        try { controller.close(); } catch {}
      }
    },
  }), {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}

// ──────────────────────────────────────────────
// GET: health check
// ──────────────────────────────────────────────
export async function GET() {
  if (isVercel) {
    // On Vercel: check if Z.ai proxy is reachable
    try {
      const res = await fetch(`${ZAI_PROXY_URL}/api/chat`, { method: 'GET' });
      const data = await res.json();
      return new Response(JSON.stringify({ status: 'ok', mode: 'vercel-proxy', proxy: data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ status: 'error', mode: 'vercel-proxy', message: e.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // On Z.ai: check SDK
  try {
    const zai = await getZAI();
    return new Response(JSON.stringify({ status: 'ok', mode: 'zai-sdk', message: 'Super Z API is running.' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ status: 'error', mode: 'zai-sdk', message: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ──────────────────────────────────────────────
// POST: chat completion
// ──────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, model, system, max_tokens, temperature, thinking, vision } = body;

    // ── Vercel mode: proxy to Z.ai space ──
    if (isVercel) {
      return await proxyToZAI(body);
    }

    // ── Z.ai platform mode: use SDK directly ──
    const zai = await getZAI();

    // Build messages array
    const apiMessages: any[] = [];
    if (system) apiMessages.push({ role: 'system', content: system });
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

    if (result instanceof ReadableStream) {
      return streamResponse(result);
    }

    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('[Super Z] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
