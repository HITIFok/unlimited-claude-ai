import { NextRequest } from 'next/server';
import { writeFile, readFile } from 'fs/promises';
import path from 'path';
import os from 'os';
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
 * Ensure .z-ai-config exists in a writable location with env var overrides.
 * The SDK reads from process.cwd()/.z-ai-config first.
 * We write a merged config there so the SDK can find it.
 */
async function ensureConfig() {
  const configPath = path.join(process.cwd(), '.z-ai-config');
  let baseConfig: any = {};

  // 1. Try to read existing .z-ai-config (contains baseUrl for local dev)
  try {
    const raw = await readFile(configPath, 'utf-8');
    baseConfig = JSON.parse(raw);
  } catch {}

  // 2. Override with environment variables (Vercel)
  if (process.env.ZAI_BASE_URL) baseConfig.baseUrl = process.env.ZAI_BASE_URL;
  if (process.env.ZAI_API_KEY) baseConfig.apiKey = process.env.ZAI_API_KEY;
  if (process.env.ZAI_CHAT_ID) baseConfig.chatId = process.env.ZAI_CHAT_ID;
  if (process.env.ZAI_TOKEN) baseConfig.token = process.env.ZAI_TOKEN;

  // 3. Write merged config back so SDK's ZAI.create() can find it
  await writeFile(configPath, JSON.stringify(baseConfig, null, 2));
  return baseConfig;
}

async function getZAI() {
  if (zaiInstance) return zaiInstance;
  await ensureConfig();
  zaiInstance = await ZAI.create();
  return zaiInstance;
}

// Debug endpoint
export async function GET() {
  let config: any = {};
  try {
    const raw = await readFile(path.join(process.cwd(), '.z-ai-config'), 'utf-8');
    config = JSON.parse(raw);
  } catch {}

  return new Response(JSON.stringify({
    status: 'ok',
    fileConfig: {
      baseUrl: config.baseUrl || 'NOT SET',
      apiKey: config.apiKey ? 'SET' : 'NOT SET',
      chatId: config.chatId ? `SET (${config.chatId.substring(0, 8)}...)` : 'NOT SET',
      token: config.token ? `SET (${config.token.substring(0, 15)}...)` : 'NOT SET',
    },
    envVars: {
      ZAI_BASE_URL: process.env.ZAI_BASE_URL ? 'SET' : 'NOT SET',
      ZAI_API_KEY: process.env.ZAI_API_KEY ? 'SET' : 'NOT SET',
      ZAI_CHAT_ID: process.env.ZAI_CHAT_ID ? 'SET' : 'NOT SET',
      ZAI_TOKEN: process.env.ZAI_TOKEN ? 'SET' : 'NOT SET',
    },
    advice: !config.baseUrl
      ? 'ERROR: No baseUrl found! Set ZAI_BASE_URL env var on Vercel to your public API URL.'
      : 'Config looks good. If /api/chat still fails, the API server might be unreachable from Vercel.',
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: NextRequest) {
  try {
    const config = await ensureConfig();

    if (!config.baseUrl) {
      return new Response(
        JSON.stringify({
          error: 'No API base URL configured. On Vercel, set the ZAI_BASE_URL environment variable to the public URL of your API server.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!config.chatId || !config.token) {
      return new Response(
        JSON.stringify({
          error: 'Missing chatId or token. Set ZAI_CHAT_ID and ZAI_TOKEN environment variables.',
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
