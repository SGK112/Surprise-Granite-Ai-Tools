const floatBtn = document.getElementById("chatbot-float-btn");
const widget = document.getElementById("chatbot-widget");
const closeBtn = document.getElementById("chatbot-close-btn");
const chatOutput = document.getElementById("chatOutput");
const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");
const spinner = document.getElementById("chatbot-spinner");
const chatForm = document.getElementById("chatbot-controls");
const attachInput = document.getElementById("attachInput");
const imagePreview = document.getElementById("imagePreview");
let attachedImage = null;

// Dynamic AI welcome message
const welcomeMsg = `👋 Hi! I'm the Surprise Granite virtual assistant. Ask me anything about our products, services, pricing, or to get started on your project.`;

function scrollToBottom() {
  chatOutput.scrollTop = chatOutput.scrollHeight;
}

function appendMessage(role, text, imgUrl) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  if (role === "ai") {
    const avatar = document.createElement("div");
    avatar.className = "bubble-avatar";
    avatar.textContent = "🤖";
    bubble.appendChild(avatar);
  }
  const textDiv = document.createElement("div");
  textDiv.className = "bubble-text";
  textDiv.innerHTML = text;
  bubble.appendChild(textDiv);
  if (imgUrl) {
    const imgElem = document.createElement("img");
    imgElem.className = "bubble-image";
    imgElem.src = imgUrl;
    bubble.appendChild(imgElem);
  }
  chatOutput.appendChild(bubble);
  setTimeout(scrollToBottom, 80);
}

function setChatbotLoading(isLoading) {
  spinner.style.display = isLoading ? "inline-block" : "none";
  sendButton.disabled = isLoading;
  chatInput.disabled = isLoading;
}

function showError(text) {
  appendMessage("ai", "⚠️ " + text);
}

async function sendMessage(message, imageFile) {
  appendMessage("user", message, imageFile ? URL.createObjectURL(imageFile) : null);
  setChatbotLoading(true);
  try {
    let response;
    if (imageFile) {
      const formData = new FormData();
      formData.append("message", message);
      formData.append("image", imageFile);
      response = await fetch("/api/chat", {
        method: "POST",
        body: formData
      });
    } else {
      response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
    }
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
  imagePreview.style.display = "none";
  imagePreview.src = "";
  attachedImage = null;
  attachInput.value = "";
}

chatForm.addEventListener("submit", e => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (!msg && !attachedImage) return;
  chatInput.value = "";
  sendMessage(msg, attachedImage);
});

floatBtn.onclick = function() {
  widget.style.display = "flex";
  floatBtn.style.display = "none";
  if (!chatOutput.innerHTML) {
    appendMessage("ai", welcomeMsg);
  }
  setTimeout(scrollToBottom, 120);
};
closeBtn.onclick = function() {
  widget.style.display = "none";
  floatBtn.style.display = "flex";
};

attachInput.addEventListener('change', function(e) {
  const file = this.files[0];
  if (file) {
    attachedImage = file;
    imagePreview.src = URL.createObjectURL(file);
    imagePreview.style.display = "inline-block";
  } else {
    attachedImage = null;
    imagePreview.src = "";
    imagePreview.style.display = "none";
  }
});
