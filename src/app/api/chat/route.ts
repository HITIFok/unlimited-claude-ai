import { NextRequest } from 'next/server';
import { readFile } from 'fs/promises';

// Model name mapping for the Z.ai internal platform API
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

/**
 * Three runtime modes:
 * - "platform": Running on Z.ai platform (space.z.ai) → uses SDK + internal API (FREE)
 * - "proxy": Running on Vercel but forwards to a Z.ai proxy URL (FREE)
 * - "public": Running on Vercel with a paid Z.ai API key
 */
async function detectMode(): Promise<{ mode: 'platform' | 'proxy' | 'public'; proxyUrl?: string }> {
  // 1. Platform mode: check for injected config at /etc/.z-ai-config
  try {
    const configStr = await readFile('/etc/.z-ai-config', 'utf-8');
    const config = JSON.parse(configStr);
    if (config.baseUrl && config.apiKey) return { mode: 'platform' };
  } catch {}

  // 2. Proxy mode: ZAI_PROXY_URL env var is set → forward to Z.ai platform (FREE)
  if (process.env.ZAI_PROXY_URL) {
    return { mode: 'proxy', proxyUrl: process.env.ZAI_PROXY_URL.replace(/\/+$/, '') };
  }

  // 3. Public mode: paid Z.ai API key
  if (process.env.ZAI_PUBLIC_API_KEY) return { mode: 'public' };

  return { mode: 'public' };
}

/**
 * Call the internal Z.ai platform API using the SDK (FREE, platform-only).
 */
async function callPlatformAPI(body: any) {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();

  if (body.vision) {
    return zai.chat.completions.createVision(body);
  }
  return zai.chat.completions.create(body);
}

/**
 * Forward request to a Z.ai platform proxy (FREE, works from Vercel).
 * The proxy is a Z.ai space deployment that has SDK access.
 */
async function callProxyAPI(proxyUrl: string, chatBody: any) {
  const response = await fetch(`${proxyUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Secret': process.env.ZAI_PROXY_SECRET || '',
    },
    body: JSON.stringify(chatBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Proxy error (${response.status}): ${errorBody}`);
  }

  return response;
}

/**
 * Call the Z.ai public paid API (OpenAI-compatible).
 */
async function callPublicAPI(body: any) {
  const apiKey = process.env.ZAI_PUBLIC_API_KEY;
  if (!apiKey) {
    throw new Error('ZAI_PUBLIC_API_KEY is not set. Get your API key from https://z.ai → API Keys page.');
  }

  const baseUrl = process.env.ZAI_PUBLIC_BASE_URL || 'https://api.z.ai/api/paas/v4';
  const response = await fetch(`${baseUrl}/chat/completions`, {
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
 * Proxy guard: when running on Z.ai platform, reject unauthenticated proxy calls.
 * This prevents anyone from using your Z.ai space as a free API without the secret.
 */
function isProxyAuthenticated(request: NextRequest): boolean {
  const secret = process.env.ZAI_PROXY_SECRET;
  if (!secret) return true; // No secret = open (for convenience during setup)
  const provided = request.headers.get('X-Proxy-Secret');
  return provided === secret;
}

// Diagnostic endpoint
export async function GET() {
  const { mode, proxyUrl } = await detectMode();
  const info: any = { status: 'ok', mode, advice: '' };

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
      info.proxySecret = process.env.ZAI_PROXY_SECRET ? 'SET' : 'NOT SET (recommended)';
      info.advice = '✅ Running on Z.ai platform. Using FREE internal API via SDK.';
      info.role = 'This deployment acts as both the app AND the proxy for Vercel.';
    } catch (e: any) {
      info.advice = `Platform config error: ${e.message}`;
    }
  } else if (mode === 'proxy') {
    info.proxyUrl,
    info.proxySecret = process.env.ZAI_PROXY_SECRET ? 'SET' : 'NOT SET';
    info.advice = `✅ Proxy mode (FREE). Chat requests are forwarded to: ${proxyUrl}`;
    info.howItWorks = 'Vercel (frontend) → Z.ai space (proxy with FREE API) → AI response';
  } else {
    info.envVars = {
      ZAI_PUBLIC_API_KEY: process.env.ZAI_PUBLIC_API_KEY ? `SET (${process.env.ZAI_PUBLIC_API_KEY.substring(0, 10)}...)` : 'NOT SET',
      ZAI_PUBLIC_BASE_URL: process.env.ZAI_PUBLIC_BASE_URL || 'DEFAULT (https://api.z.ai/api/paas/v4)',
    };
    info.advice = '⚠️ Public mode (paid). Set ZAI_PROXY_URL to use FREE proxy mode instead.';
  }

  return new Response(JSON.stringify(info, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// Live test endpoint
export async function PUT(request: NextRequest) {
  try {
    const { mode, proxyUrl } = await detectMode();
    const steps: string[] = [];
    steps.push(`Mode: ${mode}`);

    if (mode === 'platform') {
      steps.push('Testing SDK + internal API...');
      const ZAI = (await import('z-ai-web-dev-sdk')).default;
      const zai = await ZAI.create();
      const result = await zai.chat.completions.create({
        messages: [{ role: 'user', content: 'Say hi in 3 words' }],
        max_tokens: 10,
      });
      steps.push(`Result: ${JSON.stringify(result).substring(0, 300)}`);
      steps.push('✅ SUCCESS — Free API working on Z.ai platform!');
      steps.push('Set ZAI_PROXY_URL on Vercel to this space URL for free access.');
    } else if (mode === 'proxy') {
      steps.push(`Proxy URL: ${proxyUrl}`);
      steps.push('Testing proxy connection...');
      const response = await fetch(`${proxyUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Proxy-Secret': process.env.ZAI_PROXY_SECRET || '',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Say hi in 3 words' }],
          model: 'claude-sonnet-4-6',
          max_tokens: 10,
          stream: false,
        }),
      });
      const text = await response.text();
      steps.push(`Proxy status: ${response.status}`);
      steps.push(`Proxy response: ${text.substring(0, 400)}`);
      steps.push(response.ok ? '✅ SUCCESS — Proxy is working for free!' : '❌ FAIL — Check proxy URL and secret.');
    } else {
      const apiKey = process.env.ZAI_PUBLIC_API_KEY;
      steps.push(`API Key: ${apiKey ? apiKey.substring(0, 10) + '...' : 'MISSING'}`);
      if (!apiKey) {
        steps.push('❌ No API key. Set ZAI_PROXY_URL for free mode, or ZAI_PUBLIC_API_KEY for paid mode.');
      } else {
        steps.push('Testing paid API...');
        const baseUrl = process.env.ZAI_PUBLIC_BASE_URL || 'https://api.z.ai/api/paas/v4';
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Accept-Language': 'en-US,en' },
          body: JSON.stringify({ model: 'glm-4.5', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5, stream: false }),
        });
        const body = await resp.text();
        steps.push(`Status: ${resp.status} — ${body.substring(0, 200)}`);
        steps.push(resp.ok ? '✅ SUCCESS — Paid API working.' : '❌ FAIL — Check API key and balance.');
      }
    }

    return new Response(JSON.stringify({ status: 'test', steps }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ status: 'error', error: error.message }, null, 2), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Main chat endpoint
export async function POST(request: NextRequest) {
  try {
    const { mode, proxyUrl } = await detectMode();

    // Security: when acting as a proxy on Z.ai platform, verify the caller
    if (mode === 'platform' && !isProxyAuthenticated(request)) {
      return new Response(
        JSON.stringify({ error: 'Invalid proxy secret. Set X-Proxy-Secret header.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { messages, model, system, max_tokens, temperature, thinking, vision } = body;

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
    if (vision) chatBody.vision = true;

    let response: Response;

    if (mode === 'platform') {
      // Direct SDK call (FREE)
      const result = await callPlatformAPI(chatBody);

      if (result instanceof ReadableStream) {
        return streamResponse(result);
      }
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });

    } else if (mode === 'proxy') {
      // Forward to Z.ai space proxy (FREE)
      response = await callProxyAPI(proxyUrl!, chatBody);

      // Check if proxy returned JSON error
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json') && !response.body) {
        const json = await response.json();
        return new Response(JSON.stringify(json), { status: response.status, headers: { 'Content-Type': 'application/json' } });
      }
      return streamExternalResponse(response);

    } else {
      // Paid public API
      const publicModel = chatBody.model; // Keep original name for public API
      chatBody.model = model ? (MODEL_MAP[model] || model) : 'glm-4.5';
      delete chatBody.vision;
      if (thinking && thinking.type === 'enabled') {
        chatBody.thinking = { type: 'enabled' };
      }

      response = await callPublicAPI(chatBody);
      return streamExternalResponse(response);
    }
  } catch (error: any) {
    console.error('[Super Z API] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/** Stream a ReadableStream from the SDK */
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

/** Stream a fetch Response from external APIs */
function streamExternalResponse(response: Response) {
  if (!response.body) {
    return new Response('{"error":"No response body"}', { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const reader = response.body.getReader();
  return new Response(new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { controller.close(); break; }
          controller.enqueue(value);
        }
      } catch (err: any) {
        console.error('[Super Z] External stream error:', err.message);
        try { controller.close(); } catch {}
      }
    },
  }), {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
