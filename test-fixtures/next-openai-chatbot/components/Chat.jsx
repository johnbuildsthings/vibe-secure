'use client';
import { useState } from 'react';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

export function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  async function send() {
    const next = [...messages, { role: 'user', content: input }];
    setMessages(next);
    setInput('');
    const res = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: next });
    setMessages([...next, res.choices[0].message]);
  }

  return (
    <div>
      {messages.map((m, i) => <p key={i}>{m.role}: {m.content}</p>)}
      <input value={input} onChange={(e) => setInput(e.target.value)} />
      <button onClick={send}>Send</button>
    </div>
  );
}
