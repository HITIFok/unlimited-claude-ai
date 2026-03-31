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

async function getZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, model, system, max_tokens, temperature, thinking, vision } = body;

    const zai = await getZAI();

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

    const chatBody: any = { messages: apiMessages, stream: true };
    if (model) chatBody.model = MODEL_MAP[model] || model;
    if (max_tokens) chatBody.max_tokens = max_tokens;
    if (temperature !== undefined) chatBody.temperature = temperature;
    if (thinking) chatBody.thinking = thinking;

    let result;
    if (vision) {
      result = await zai.chat.completions.createVision(chatBody);
    } else {
      result = await zai.chat.completions.create(chatBody);
    }

    // SDK returns ReadableStream for streaming
    if (result instanceof ReadableStream) {
      return new Response(result, {
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
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
