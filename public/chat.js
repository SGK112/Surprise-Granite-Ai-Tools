const chatInput = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");
const chatOutput = document.getElementById("chatOutput");
const recordButton = document.getElementById("recordButton");

let recognition;
if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onresult = function (event) {
    const transcript = event.results[0][0].transcript;
    chatInput.value = transcript; // Autofill chat input
    sendMessage(transcript); // Send voice input as text
  };

  recognition.onerror = function (event) {
    console.error("Speech recognition error:", event.error);
  };
} else {
  console.warn("Speech recognition not supported in this browser.");
}

// Start recording voice
recordButton.addEventListener("click", function () {
  if (recognition) {
    recognition.start();
  } else {
    alert("Your browser does not support speech recognition.");
  }
});

// Function to send message to AI backend
async function sendMessage(message) {
  // Ensure there's content to send
  if (!message.trim()) return;

  chatOutput.innerHTML += `<p><strong>You:</strong> ${message}</p>`;
  chatInput.value = ""; // Clear input after sending

  try {
    const response = await fetch("https://surprise-granite-connections-dev.onrender.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }) // Adjusted to match expected backend parameter
    });

    const data = await response.json();
    chatOutput.innerHTML += `<p><strong>AI:</strong> ${data.message}</p>`;
    speakResponse(data.message); // Convert AI response to speech

    scrollToBottom(); // Scroll chat to the bottom after sending/receiving
  } catch (error) {
    console.error("Error sending message:", error);
    chatOutput.innerHTML += `<p><strong>AI:</strong> Sorry, I couldn't process your request. Please try again.</p>`;
    scrollToBottom();
  }
}

// Function to convert AI response to speech
function speakResponse(text) {
  const speech = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();

  // Wait for voices to be available, if needed
  if (voices.length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      speakResponse(text); // Retry once voices are loaded
    };
    return;
  }

  // Select the most human-like voice
  let bestVoice = voices.find(voice =>
    voice.name.includes("US English") ||
    voice.name.includes("UK English") ||
    voice.name.includes("Daniel") ||
    voice.name.includes("Samantha") ||
    voice.name.includes("Alex")
  );

  speech.voice = bestVoice || voices[0]; // Use best match or default voice
  speech.rate = 1.1; // Slightly faster for a natural flow
  speech.volume = 1; // Full volume
  speech.pitch = 1.1; // Higher pitch for a less robotic sound

  window.speechSynthesis.speak(speech);
}

// Scroll chat to the bottom after a new message
function scrollToBottom() {
  chatOutput.scrollTop = chatOutput.scrollHeight;
}

// Send message manually when clicking send button
sendButton.addEventListener("click", function () {
  const message = chatInput.value;
  sendMessage(message);
});
