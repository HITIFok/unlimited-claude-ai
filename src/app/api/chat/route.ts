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
    baseUrl: process.env.ZAI_BASE_URL || 'https://z-ai-web-dev.z.ai/v1',
    apiKey: process.env.ZAI_API_KEY || 'Z.ai',
    chatId: process.env.ZAI_CHAT_ID || '',
    token: process.env.ZAI_TOKEN || '',
  };
}

export async function POST(request: NextRequest) {
  try {
    const config = getConfig();

    if (!config.chatId || !config.token) {
      console.error('[Super Z API] Missing ZAI_CHAT_ID or ZAI_TOKEN env vars');
      return new Response(
        JSON.stringify({ error: 'API not configured. Please set ZAI_CHAT_ID and ZAI_TOKEN environment variables.' }),
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
    // Default to disabled thinking unless explicitly enabled
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

    console.log(`[Super Z API] Calling ${url} with model=${apiModel}, messages=${apiMessages.length}`);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Super Z API] Error ${response.status}: ${errorText}`);
      return new Response(
        JSON.stringify({ error: `API returned ${response.status}: ${errorText.substring(0, 500)}` }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Stream the response back to the client
    if (response.body) {
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Fallback: return JSON
    const json = await response.json();
    return new Response(JSON.stringify(json), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Super Z API] Unhandled error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
