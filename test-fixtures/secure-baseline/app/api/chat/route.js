import OpenAI from 'openai';
import { getUser } from '../../../lib/supabase-admin.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const LIMIT = 20;
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map();

function allowed(userId) {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) return false;
  hits.set(userId, [...recent, now]);
  return true;
}

// No tools are given to the model: it can only produce text.
export async function POST(req) {
  const user = await getUser(req);
  if (!user) return Response.json({ error: 'Sign in first' }, { status: 401 });
  if (!allowed(user.id)) return Response.json({ error: 'Too many requests' }, { status: 429 });
  const { message } = await req.json();
  if (typeof message !== 'string' || message.length > 1000) {
    return Response.json({ error: 'Message too long' }, { status: 400 });
  }
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 400,
    messages: [
      { role: 'system', content: 'You are a helpful shop assistant.' },
      { role: 'user', content: message },
    ],
  });
  return Response.json({ reply: completion.choices[0].message.content });
}
