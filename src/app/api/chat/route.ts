import { NextRequest } from 'next/server';

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

function getConfig() {
  return {
    baseUrl: process.env.ZAI_BASE_URL || '',
    apiKey: process.env.ZAI_API_KEY || '',
    chatId: process.env.ZAI_CHAT_ID || '',
    token: process.env.ZAI_TOKEN || '',
  };
}

// Debug endpoint — helps diagnose env var issues on Vercel
export async function GET() {
  const config = getConfig();
  return new Response(JSON.stringify({
    status: 'ok',
    config: {
      baseUrl: config.baseUrl ? `${config.baseUrl.substring(0, 30)}...` : 'NOT SET',
      apiKey: config.apiKey ? 'SET' : 'NOT SET',
      chatId: config.chatId ? `SET (${config.chatId.substring(0, 8)}...)` : 'NOT SET',
      token: config.token ? `SET (${config.token.substring(0, 15)}...)` : 'NOT SET',
    },
    nodeEnv: process.env.NODE_ENV,
    message: config.chatId && config.token
      ? 'Environment variables look good. If /api/chat still fails, check the baseUrl.'
      : 'WARNING: ZAI_CHAT_ID and/or ZAI_TOKEN are not set in environment variables!',
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: NextRequest) {
  try {
    const config = getConfig();

    if (!config.chatId || !config.token) {
      return new Response(
        JSON.stringify({ error: 'API not configured. Set ZAI_CHAT_ID and ZAI_TOKEN in Vercel env vars.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!config.baseUrl) {
      return new Response(
        JSON.stringify({ error: 'ZAI_BASE_URL not set. Add it in Vercel env vars (e.g. https://your-api-host/v1).' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { messages, model, system, max_tokens, temperature, thinking, vision } = body;

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

    // Map model name
    const apiModel = model ? (MODEL_MAP[model] || model) : 'claude-sonnet-4-6';

    // Build request body
    const requestBody: any = {
      messages: apiMessages,
      model: apiModel,
      stream: true,
    };
    if (max_tokens) requestBody.max_tokens = max_tokens;
    if (temperature !== undefined) requestBody.temperature = temperature;
    requestBody.thinking = thinking || { type: 'disabled' };

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'X-Z-AI-From': 'Z',
      'X-Chat-Id': config.chatId,
      'X-Token': config.token,
    };

    // Choose endpoint
    const url = vision
      ? `${config.baseUrl}/chat/completions/vision`
      : `${config.baseUrl}/chat/completions`;

    console.log(`[Super Z API] POST ${url} model=${apiModel} messages=${apiMessages.length}`);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Super Z API] Error ${response.status}: ${errorText}`);
      return new Response(
        JSON.stringify({ error: `API ${response.status}: ${errorText.substring(0, 500)}` }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Stream the response — use TransformStream for Vercel compatibility
    if (response.body) {
      const reader = response.body.getReader();

      const stream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                break;
              }
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

    // Fallback
    const json = await response.json();
    return new Response(JSON.stringify(json), {
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
