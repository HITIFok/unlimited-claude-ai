import { NextRequest } from 'next/server';
import { readFile } from 'fs/promises';

// Model name mapping for internal Z.ai platform
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

// Model name mapping for Groq (free API)
const GROQ_MODEL_MAP: Record<string, string> = {
  'sz-opus-4-6': 'llama-3.3-70b-versatile',
  'sz-sonnet-4-6': 'llama-3.3-70b-versatile',
  'sz-opus-4-5': 'llama-3.3-70b-versatile',
  'sz-sonnet-4-5': 'llama-3.3-70b-versatile',
  'sz-sonnet-4': 'llama-3.1-8b-instant',
  'sz-opus-4': 'llama-3.3-70b-versatile',
  'sz-3-7-sonnet': 'llama-3.1-8b-instant',
  'sz-3-5-sonnet': 'llama-3.1-8b-instant',
  'sz-3-5-haiku': 'llama-3.1-8b-instant',
};

async function detectMode(): Promise<'platform' | 'vercel'> {
  try {
    const configStr = await readFile('/etc/.z-ai-config', 'utf-8');
    const config = JSON.parse(configStr);
    if (config.baseUrl && config.apiKey) return 'platform';
  } catch {}
  return 'vercel';
}

/** Call Z.ai internal API via SDK (FREE, platform only) */
async function callPlatformAPI(chatBody: any) {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  if (chatBody.vision) return zai.chat.completions.createVision(chatBody);
  return zai.chat.completions.create(chatBody);
}

/** Call Groq API (FREE, OpenAI-compatible). Get key: https://console.groq.com/keys */
async function callGroqAPI(chatBody: any, apiKey: string) {
  const model = GROQ_MODEL_MAP[chatBody.model] || 'llama-3.3-70b-versatile';
  const baseUrl = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
  const url = `${baseUrl}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: chatBody.messages,
      stream: true,
      max_tokens: chatBody.max_tokens || 4096,
      temperature: chatBody.temperature ?? 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error (${response.status}): ${err}`);
  }
  return response;
}

/** Stream a fetch Response */
function streamResponse(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
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

// Diagnostic
export async function GET() {
  const mode = await detectMode();
  const info: any = { status: 'ok', mode };

  if (mode === 'platform') {
    info.advice = '✅ Z.ai platform — FREE via SDK.';
  } else {
    info.envVars = {
      GROQ_API_KEY: process.env.GROQ_API_KEY ? `SET (${process.env.GROQ_API_KEY.substring(0, 8)}...)` : 'NOT SET',
    };
    info.advice = process.env.GROQ_API_KEY
      ? '✅ Using FREE Groq API.'
      : '❌ GROQ_API_KEY not set. Get a FREE key at https://console.groq.com/keys';
  }
  return new Response(JSON.stringify(info, null, 2), { headers: { 'Content-Type': 'application/json' } });
}

// Test
export async function PUT(request: NextRequest) {
  try {
    const mode = await detectMode();
    const steps: string[] = [`Mode: ${mode}`];

    if (mode === 'platform') {
      const ZAI = (await import('z-ai-web-dev-sdk')).default;
      const zai = await ZAI.create();
      const r = await zai.chat.completions.create({ messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5 });
      steps.push(`✅ SDK works: ${JSON.stringify(r).substring(0, 200)}`);
    } else {
      const key = process.env.GROQ_API_KEY;
      if (!key) {
        steps.push('❌ No GROQ_API_KEY. Get FREE key: https://console.groq.com/keys');
      } else {
        steps.push(`Key: ${key.substring(0, 8)}...`);
        const baseUrl = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'Say hi' }], max_tokens: 5, stream: false }),
        });
        const body = await resp.text();
        steps.push(`Status: ${resp.status} — ${body.substring(0, 300)}`);
        steps.push(resp.ok ? '✅ Groq is working!' : '❌ Check your key.');
      }
    }
    return new Response(JSON.stringify({ status: 'test', steps }, null, 2), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ status: 'error', error: e.message }, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Chat
export async function POST(request: NextRequest) {
  try {
    const mode = await detectMode();
    const body = await request.json();
    const { messages, model, system, max_tokens, temperature, thinking, vision } = body;

    const apiMessages: any[] = [];
    if (system) apiMessages.push({ role: 'system', content: system });
    if (messages && Array.isArray(messages)) {
      for (const msg of messages) {
        if (msg.attachments?.length > 0) {
          const imgs = msg.attachments.filter((a: any) => a.isImage);
          if (imgs.length > 0) {
            apiMessages.push({
              role: msg.role,
              content: [
                { type: 'text', text: msg.content || 'Analyze these images.' },
                ...imgs.map((a: any) => ({ type: 'image_url', image_url: { url: a.base64 } })),
              ],
            });
            continue;
          }
        }
        apiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const apiModel = model ? (MODEL_MAP[model] || model) : 'claude-sonnet-4-6';
    const chatBody: any = { messages: apiMessages, stream: true, model: apiModel };
    if (max_tokens) chatBody.max_tokens = max_tokens;
    if (temperature !== undefined) chatBody.temperature = temperature;
    chatBody.thinking = thinking || { type: 'disabled' };
    if (vision) chatBody.vision = true;

    if (mode === 'platform') {
      const result = await callPlatformAPI(chatBody);
      if (result instanceof ReadableStream) return streamResponse(result);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }

    // Vercel → Groq (FREE)
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return new Response(
        JSON.stringify({ error: 'GROQ_API_KEY not set. Get a FREE key at https://console.groq.com/keys and add it in Vercel.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const response = await callGroqAPI(chatBody, groqKey);
    if (response.body) return streamResponse(response.body);
    return new Response('{"error":"No response"}', { status: 500, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    console.error('[Super Z] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
