import { NextRequest } from 'next/server';
import { readFile } from 'fs/promises';

// Model name mapping (Super Z names → API names)
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
 * Detect runtime environment:
 * - "platform": On Z.ai platform (space.z.ai) → FREE via SDK
 * - "vercel": On Vercel → uses free Gemini API (no payment needed)
 */
async function detectMode(): Promise<'platform' | 'vercel'> {
  try {
    const configStr = await readFile('/etc/.z-ai-config', 'utf-8');
    const config = JSON.parse(configStr);
    if (config.baseUrl && config.apiKey) return 'platform';
  } catch {}
  return 'vercel';
}

/**
 * Call Z.ai internal API via SDK (FREE, platform only).
 */
async function callPlatformAPI(chatBody: any) {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();

  if (chatBody.vision) {
    return zai.chat.completions.createVision(chatBody);
  }
  return zai.chat.completions.create(chatBody);
}

/**
 * Call Google Gemini API (FREE tier).
 * Get API key: https://aistudio.google.com/apikey
 */
async function callGeminiAPI(chatBody: any, geminiKey: string) {
  // Map Super Z model names to Gemini models
  const geminiModelMap: Record<string, string> = {
    'claude-opus-4-6': 'gemini-2.5-flash',
    'claude-sonnet-4-6': 'gemini-2.5-flash',
    'claude-opus-4-5': 'gemini-2.5-flash',
    'claude-sonnet-4-5': 'gemini-2.5-flash',
    'claude-sonnet-4': 'gemini-2.0-flash',
    'claude-opus-4': 'gemini-2.5-flash',
    'claude-3-7-sonnet': 'gemini-2.0-flash',
    'claude-3-5-sonnet': 'gemini-2.0-flash',
    'claude-3-5-haiku': 'gemini-2.0-flash-lite',
  };

  const model = geminiModelMap[chatBody.model] || 'gemini-2.5-flash';

  // Convert messages to Gemini format
  const contents = (chatBody.messages || [])
    .filter((m: any) => m.role !== 'system')
    .map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  // System instruction (extracted from messages)
  const systemInstruction = chatBody.messages
    ?.filter((m: any) => m.role === 'system')
    .map((m: any) => m.content)
    .join('\n') || undefined;

  const requestBody: any = {
    contents,
    generationConfig: {
      maxOutputTokens: chatBody.max_tokens || 8192,
      temperature: chatBody.temperature ?? 0.7,
    },
  };
  if (systemInstruction) {
    requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  if (chatBody.thinking?.type === 'enabled') {
    requestBody.generationConfig.thinkingConfig = { thinkingBudget: 10000 };
  }

  const baseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
  const url = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${geminiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
  }

  return response;
}

/**
 * Convert Gemini SSE format to OpenAI-compatible SSE format.
 * Gemini: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}
 * OpenAI: {"choices":[{"delta":{"content":"..."}}]}
 */
function geminiToOpenAIStream(geminiStream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = geminiStream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const gemini = JSON.parse(jsonStr);

              // Extract text from Gemini response
              const text = gemini.candidates?.[0]?.content?.parts?.[0]?.text || '';

              if (gemini.candidates?.[0]?.finishReason === 'STOP') {
                // Send finish event
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                continue;
              }

              if (text) {
                // Convert to OpenAI format
                const openaiChunk = {
                  choices: [{ delta: { content: text }, index: 0 }],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
              }
            } catch (e) {
              // Skip unparseable chunks
            }
          }
        }
        // Ensure DONE is sent
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err: any) {
        console.error('[Gemini stream] Error:', err.message);
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } finally {
        controller.close();
      }
    },
  });
}

// Diagnostic endpoint
export async function GET() {
  const mode = await detectMode();
  const info: any = { status: 'ok', mode, advice: '' };

  if (mode === 'platform') {
    info.advice = '✅ Running on Z.ai platform — FREE mode via SDK.';
  } else {
    info.envVars = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ? `SET (${process.env.GEMINI_API_KEY.substring(0, 8)}...)` : 'NOT SET',
      GEMINI_BASE_URL: process.env.GEMINI_BASE_URL || 'DEFAULT',
    };
    if (process.env.GEMINI_API_KEY) {
      info.advice = '✅ Using FREE Google Gemini API. Get key at https://aistudio.google.com/apikey';
    } else {
      info.advice = '❌ GEMINI_API_KEY not set. Get a FREE key at https://aistudio.google.com/apikey and add it in Vercel env vars.';
    }
  }

  return new Response(JSON.stringify(info, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// Test endpoint
export async function PUT(request: NextRequest) {
  try {
    const mode = await detectMode();
    const steps: string[] = [];
    steps.push(`Mode: ${mode}`);

    if (mode === 'platform') {
      steps.push('Testing SDK...');
      const ZAI = (await import('z-ai-web-dev-sdk')).default;
      const zai = await ZAI.create();
      const result = await zai.chat.completions.create({
        messages: [{ role: 'user', content: 'Say hi in 3 words' }],
        max_tokens: 10,
      });
      steps.push(`✅ ${JSON.stringify(result).substring(0, 200)}`);
    } else {
      const key = process.env.GEMINI_API_KEY;
      if (!key) {
        steps.push('❌ No GEMINI_API_KEY set.');
        steps.push('Go to https://aistudio.google.com/apikey to get a FREE API key.');
      } else {
        steps.push(`Gemini key: ${key.substring(0, 8)}...`);
        steps.push('Testing Gemini API...');
        const baseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
        const resp = await fetch(`${baseUrl}/models/gemini-2.0-flash:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Say hi in 3 words' }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
        });
        const body = await resp.text();
        steps.push(`Status: ${resp.status} — ${body.substring(0, 300)}`);
        steps.push(resp.ok ? '✅ Gemini is working!' : '❌ Check your API key.');
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
    const mode = await detectMode();
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

    if (mode === 'platform') {
      // ─── Z.ai Platform: FREE via SDK ───
      const result = await callPlatformAPI(chatBody);

      if (result instanceof ReadableStream) {
        return new Response(new ReadableStream({
          async start(controller) {
            const reader = result.getReader();
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
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });

    } else {
      // ─── Vercel: FREE via Google Gemini API ───
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return new Response(
          JSON.stringify({
            error: 'GEMINI_API_KEY is not set. Get a FREE API key at https://aistudio.google.com/apikey and add it as a Vercel environment variable.',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const geminiResponse = await callGeminiAPI(chatBody, geminiKey);

      if (geminiResponse.body) {
        const convertedStream = geminiToOpenAIStream(geminiResponse.body);
        return new Response(convertedStream, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        });
      }

      return new Response('{"error":"No response body from Gemini"}', {
        status: 500, headers: { 'Content-Type': 'application/json' },
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
