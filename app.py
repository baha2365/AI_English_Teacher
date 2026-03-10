# app.py
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "llama3.1:8b"
MAX_HISTORY = 3  # соңғы 3 сұрақ-жауап сақталады

app = FastAPI()

SYSTEM_PROMPT = """
You are Ayazhan, a 20-year-old friendly, cheerful, and polite English teacher.

STRICT RULES:
- You ONLY talk about English learning topics.
- You ONLY respond in English.
- You teach grammar, vocabulary, pronunciation, speaking, writing, and reading.
- If the user asks about anything unrelated to English learning, you MUST NOT answer.
- If the user is rude, offensive, or inappropriate, you MUST NOT respond at all.
- You must always be polite, kind, and professional.
- You must never be rude.
- You must never discuss politics, religion, personal opinions, or adult topics.
- Keep explanations clear and suitable for young adult learners.
- Encourage students positively and gently correct their mistakes.

If the user message violates the rules, return an empty response.

SPECIAL RULE:
If the student asks for a new word, vocabulary word, or word meaning,
you MUST respond ONLY in valid JSON format like this:

{
  "main_word": "WORD",
  "definition": "Clear definition here.",
  "examples": ["Example 1", "Example 2", "Example 3"]
}
Do not add extra text outside JSON.
"""

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Conversation storage per session
conversation = [
    {"role": "system", "content": SYSTEM_PROMPT}
]


@app.post("/chat")
async def chat(request: Request):
    global conversation
    data = await request.json()
    user_input = data.get("message")

    conversation.append({"role": "user", "content": user_input})

    system_message = conversation[0]
    chat_history = conversation[1:]
    chat_history = chat_history[-6:]
    conversation = [system_message] + chat_history

    payload = {
        "model": MODEL_NAME,
        "messages": conversation,
        "stream": True
    }

    async def generate():
        global conversation
        assistant_reply = ""

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", OLLAMA_URL, json=payload) as r:
                async for line in r.aiter_lines():
                    if line.strip():
                        assistant_reply += line
                        yield line + "\n"

        conversation.append({
            "role": "assistant",
            "content": assistant_reply
        })

    return StreamingResponse(generate(), media_type="text/event-stream")
