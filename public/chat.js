const floatBtn = document.getElementById("chatbot-float-btn");
const widget = document.getElementById("chatbot-widget");
const closeBtn = document.getElementById("chatbot-close-btn");
const chatOutput = document.getElementById("chatOutput");
const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");
const spinner = document.getElementById("chatbot-spinner");
const chatForm = document.getElementById("chatbot-controls");

function scrollToBottom() {
  chatOutput.scrollTop = chatOutput.scrollHeight;
}

function appendMessage(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "bubble-avatar";
  avatar.textContent = role === "ai" ? "🤖" : "";
  const textDiv = document.createElement("div");
  textDiv.className = "bubble-text";
  textDiv.textContent = text;
  if (role === "ai") bubble.appendChild(avatar);
  bubble.appendChild(textDiv);
  chatOutput.appendChild(bubble);
  scrollToBottom();
}

function setChatbotLoading(isLoading) {
  spinner.style.display = isLoading ? "inline-block" : "none";
  sendButton.disabled = isLoading;
  chatInput.disabled = isLoading;
}

function showError(text) {
  appendMessage("ai", "⚠️ " + text);
}

async function sendMessage(message) {
  appendMessage("user", message);
  setChatbotLoading(true);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      showError(err.error || "AI backend error.");
      setChatbotLoading(false);
      return;
    }
    const data = await response.json();
    appendMessage("ai", data.message);
  } catch (e) {
    showError("Could not reach the server. Please try again.");
  }
  setChatbotLoading(false);
}

chatForm.addEventListener("submit", e => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (!msg) return;
  chatInput.value = "";
  sendMessage(msg);
});

floatBtn.onclick = () => {
  widget.style.display = "flex";
  floatBtn.style.display = "none";
  setTimeout(scrollToBottom, 120);
};
closeBtn.onclick = () => {
  widget.style.display = "none";
  floatBtn.style.display = "flex";
};

// Optional: Open on load for desktop demo
if (window.innerWidth > 700) setTimeout(() => floatBtn.click(), 600);
