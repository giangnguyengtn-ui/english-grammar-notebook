const ALLOWED_ORIGINS = [
  "https://giangnguyengtn-ui.github.io",
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)*claude\.ai$/.test(origin)) return true;
  return false;
}

function corsHeaders(origin) {
  const allow = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

const SYSTEM_PROMPT = `You are a warm, natural English conversation partner helping a Vietnamese adult learner (B1-B2 level) practice SPEAKING English out loud.

Rules:
- Reply in spoken, natural English — the way a friendly native speaker would talk, not written prose.
- Keep replies SHORT: 1-3 sentences. This is a live voice conversation, not an essay.
- Always end with a short follow-up question to keep the conversation going, unless the learner is clearly wrapping up.
- Stay on the given topic for the day, but follow the learner's lead naturally if they drift — a real conversation partner would.
- If the learner makes a clear grammar mistake, do NOT interrupt the flow. Instead, naturally reply first, then on a new line add: "💡 " followed by ONE short correction tip (the wrong bit → the fixed bit), only if there's a real mistake worth noting. Skip this line entirely if their English was fine.
- Never lecture, never give a long grammar explanation — save that for the writing/grammar sections of their course. Here, the goal is fluency and confidence.
- If the learner writes in Vietnamese, gently encourage them (in English) to try saying it in English, unless they're asking what a word means — then briefly help, then return to English.`;

async function handleChat(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid_json" }, 400, origin);
  }

  const topic = String(body.topic || "everyday English").slice(0, 200);
  const message = String(body.message || "").slice(0, 1000);
  let history = Array.isArray(body.history) ? body.history : [];
  history = history.slice(-16).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 1000),
  }));

  if (!message.trim()) {
    return json({ error: "empty_message" }, 400, origin);
  }

  const messages = [...history, { role: "user", content: message }];

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 220,
      system: `${SYSTEM_PROMPT}\n\nToday's topic: ${topic}`,
      messages,
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return json({ error: "upstream_error", detail: errText.slice(0, 300) }, 502, origin);
  }

  const data = await anthropicRes.json();
  const reply = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return json({ reply }, 200, origin);
}

const SYSTEM_PROMPT_GRADE = `You are an English writing tutor for a Vietnamese adult learner (B1-B2) practicing writing.

Rules:
- Respond in Vietnamese, except when quoting the learner's own English sentences.
- Be concrete and specific — quote the learner's exact words, never generic praise.
- Structure the reply in exactly this order, each section starting on its own line:
  "Ngữ pháp & thì:" — list concrete grammar/tense mistakes as "sai → đúng", with a one-line reason each. If none, say so briefly.
  "Tự nhiên hay dịch?:" — quote every sentence that reads like a word-by-word translation from Vietnamese and rewrite it naturally. If none, say so briefly.
  "Nâng cấp:" — give exactly 2 more advanced/natural ways to express something from the essay.
- Keep the whole reply under 220 words. No preamble, no closing remarks, no markdown headers/asterisks.`;

async function handleGrade(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid_json" }, 400, origin);
  }

  const task = String(body.task || "").slice(0, 500);
  const essay = String(body.essay || "").slice(0, 4000);

  if (!essay.trim()) {
    return json({ error: "empty_essay" }, 400, origin);
  }

  const userMsg = `Đề bài: ${task}\n\nBài viết của học viên:\n${essay}`;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: SYSTEM_PROMPT_GRADE,
      messages: [{ role: "user", content: userMsg }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return json({ error: "upstream_error", detail: errText.slice(0, 300) }, 502, origin);
  }

  const data = await anthropicRes.json();
  const reply = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return json({ reply }, 200, origin);
}

const SYSTEM_PROMPT_ASK = `You are a knowledgeable, patient English tutor answering quick study questions from a Vietnamese adult learner (B1-B2) — this is a Q&A helper, NOT a speaking-practice conversation partner.

Rules:
- Answer in Vietnamese; quote English words/sentences as needed.
- Give clear, sufficiently detailed explanations — grammar rules, word meanings, usage differences, whatever is asked. Unlike casual chat, thorough explanations ARE wanted here.
- Include 1-2 short example sentences when it helps illustrate the point.
- If relevant, name the grammar concept (e.g. "Present Perfect", "stative verb", "collocation").
- Keep answers focused: a few sentences to a short paragraph, unless the learner explicitly asks to go deeper.
- If the question is ambiguous, ask ONE brief clarifying question instead of guessing.`;

async function handleAsk(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid_json" }, 400, origin);
  }

  const context = String(body.context || "").slice(0, 200);
  const message = String(body.message || "").slice(0, 1000);
  let history = Array.isArray(body.history) ? body.history : [];
  history = history.slice(-16).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 1000),
  }));

  if (!message.trim()) {
    return json({ error: "empty_message" }, 400, origin);
  }

  const messages = [...history, { role: "user", content: message }];

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: context ? `${SYSTEM_PROMPT_ASK}\n\nHọc viên đang xem bài: ${context}` : SYSTEM_PROMPT_ASK,
      messages,
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return json({ error: "upstream_error", detail: errText.slice(0, 300) }, 502, origin);
  }

  const data = await anthropicRes.json();
  const reply = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return json({ reply }, 200, origin);
}

const SYSTEM_PROMPT_FEEDBACK = `You are an English speaking coach giving feedback on a Vietnamese adult learner's (B1-B2) spoken answer to a practice question. The input is a raw speech-to-text transcript of their spoken answer — ignore missing punctuation/capitalization, that's just how speech-to-text works, not a real error.

Rules:
- Respond in Vietnamese; quote the learner's own English words as needed.
- Structure the reply in exactly this order, each section starting on its own line:
  "Nhận xét chung:" — 1-2 sentences on overall impression: did they actually answer the question, how complete/relevant was it.
  "Ngữ pháp cần sửa:" — list concrete grammar/tense mistakes as "sai → đúng" with a one-line reason each. If none, say so briefly.
  "Nói tự nhiên hơn:" — quote any phrase that sounds like a word-by-word translation from Vietnamese and rewrite it naturally. If none, say so briefly.
  "Để nói tốt hơn:" — 1-2 concrete, actionable SPEAKING tips based specifically on this transcript (e.g. use a chunk instead of a filler pause, connect ideas with a linking phrase, vary sentence length) — not generic advice.
- Keep the whole reply under 200 words. No preamble, no closing remarks, no markdown headers/asterisks.`;

async function handleFeedback(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid_json" }, 400, origin);
  }

  const question = String(body.question || "").slice(0, 500);
  const transcript = String(body.transcript || "").slice(0, 3000);

  if (!transcript.trim()) {
    return json({ error: "empty_transcript" }, 400, origin);
  }

  const userMsg = `Câu hỏi: ${question}\n\nCâu trả lời (transcript giọng nói) của học viên:\n${transcript}`;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: SYSTEM_PROMPT_FEEDBACK,
      messages: [{ role: "user", content: userMsg }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return json({ error: "upstream_error", detail: errText.slice(0, 300) }, 502, origin);
  }

  const data = await anthropicRes.json();
  const reply = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return json({ reply }, 200, origin);
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      return handleChat(request, env, origin);
    }

    if (url.pathname === "/grade" && request.method === "POST") {
      return handleGrade(request, env, origin);
    }

    if (url.pathname === "/ask" && request.method === "POST") {
      return handleAsk(request, env, origin);
    }

    if (url.pathname === "/feedback" && request.method === "POST") {
      return handleFeedback(request, env, origin);
    }

    if (url.pathname === "/health") {
      return json({ ok: true }, 200, origin);
    }

    return json({ error: "not_found" }, 404, origin);
  },
};
