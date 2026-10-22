import OpenAI from 'openai';
import pg from 'pg';

const openai = new OpenAI({ apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const tools = [{
  type: 'function',
  function: {
    name: 'run_sql',
    description: 'Look up anything in the database for the user',
    parameters: { type: 'object', properties: { where: { type: 'string' } }, required: ['where'] },
  },
}];

export async function POST(req) {
  const { message } = await req.json();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: message }],
    tools,
  });
  const call = completion.choices[0].message.tool_calls?.[0];
  if (call) {
    const { where } = JSON.parse(call.function.arguments);
    const rows = await pool.query(`SELECT * FROM orders WHERE ${where}`);
    return Response.json({ rows: rows.rows });
  }
  return Response.json({ reply: completion.choices[0].message.content });
}
