import requests
import json

url = "http://localhost:11434/api/chat"

conversation = []

print("Type 'exit' to stop.\n")

while True:
    user_input = input("You: ")

    if user_input.lower() == "exit":
        break

    # Add user message to conversation
    conversation.append({
        "role": "user",
        "content": user_input
    })

    payload = {
        "model": "llama3.1:8b",
        "messages": conversation,
        "stream": True
    }

    response = requests.post(url, json=payload, stream=True)

    assistant_reply = ""

    print("Assistant: ", end="", flush=True)

    for line in response.iter_lines(decode_unicode=True):
        if line:
            json_data = json.loads(line)
            if "message" in json_data and "content" in json_data["message"]:
                content = json_data["message"]["content"]
                assistant_reply += content
                print(content, end="", flush=True)

    print("\n")

    # Add assistant response to conversation
    conversation.append({
        "role": "assistant",
        "content": assistant_reply
    })
