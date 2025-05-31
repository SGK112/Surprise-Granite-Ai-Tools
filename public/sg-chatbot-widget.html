<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Surprise Granite AI Chatbot">
  <title>Surprise Granite AI Chatbot</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    :root {
      --primary-blue: #1e3a8a;
      --primary-yellow: #facc15;
      --text-dark: #1f2937;
      --text-light: #ffffff;
      --bg-light: #f3f4f6;
      --bg-message-user: #facc15;
      --bg-message-bot: #f9fafb;
      --shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      --keyboard-bg: #e5e7eb;
      --key-bg: #ffffff;
      --key-hover: #d1d5db;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    body {
      font-family: 'Poppins', sans-serif;
      background-color: var(--bg-light);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 0;
    }

    .chat-container {
      width: 100%;
      max-width: 450px;
      background-color: var(--text-light);
      border-radius: 1.5rem;
      box-shadow: var(--shadow);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 85vh;
      transition: opacity 0.3s ease, transform 0.3s ease;
      touch-action: manipulation;
      position: relative;
      animation: openChat 0.3s ease-out;
    }

    .chat-container.hidden {
      opacity: 0;
      transform: scale(0.8);
      display: none;
    }

    .chat-header {
      background: linear-gradient(135deg, var(--primary-blue), #3b82f6);
      color: var(--text-light);
      padding: 0.75rem;
      text-align: center;
      font-size: 1.25rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      border-top-left-radius: 1.5rem;
      border-top-right-radius: 1.5rem;
      z-index: 10;
    }

    .chat-header img {
      width: 32px;
      height: 32px;
      border-radius: 50%;
    }

    .chat-header .close-header {
      display: none;
      color: var(--text-light);
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0.5rem;
    }

    .chat-messages {
      flex: 1;
      padding: 0.75rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      -webkit-overflow-scrolling: touch;
    }

    .message {
      max-width: 80%;
      padding: 0.5rem 0.75rem;
      border-radius: 1rem;
      font-size: 0.95rem;
      line-height: 1.5;
      position: relative;
      animation: fadeIn 0.3s ease;
    }

    .message.user {
      background-color: var(--bg-message-user);
      color: var(--text-dark);
      align-self: flex-end;
      border-bottom-right-radius: 0;
    }

    .message.bot {
      background-color: var(--bg-message-bot);
      color: var(--text-dark);
      align-self: flex-start;
      border-bottom-left-radius: 0;
      box-shadow: var(--shadow);
      border-left: 3px solid var(--primary-blue);
    }

    .message.bot img {
      max-width: 100%;
      border-radius: 0.5rem;
      margin-top: 0.5rem;
    }

    .message.bot a {
      color: var(--primary-blue);
      text-decoration: underline;
      word-break: break-all;
    }

    .message .timestamp {
      font-size: 0.7rem;
      color: #6b7280;
      margin-top: 0.25rem;
      text-align: right;
    }

    .typing-indicator {
      display: none;
      padding: 0.5rem;
      color: #6b7280;
      font-style: italic;
    }

    .typing-indicator::after {
      content: '...';
      animation: dots 1s infinite;
    }

    .quick-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      padding: 0.4rem 0.75rem;
      background-color: var(--bg-light);
      max-height: 40px;
      overflow-y: auto;
      z-index: 10;
    }

    .quick-reply {
      padding: 0.3rem 0.7rem;
      background-color: var(--primary-blue);
      color: var(--text-light);
      border: none;
      border-radius: 0.8rem;
      font-size: 0.75rem;
      cursor: pointer;
      touch-action: manipulation;
      transition: background-color 0.2s, transform 0.1s;
    }

    .quick-reply:active {
      transform: scale(0.95);
    }

    .quick-reply:hover {
      background-color: #1e40af;
    }

    .chat-input {
      display: flex;
      padding: 0.5rem;
      background-color: var(--bg-light);
      border-top: 1px solid #d1d5db;
      z-index: 10;
    }

    .chat-input input {
      flex: 1;
      padding: 0.6rem;
      border: 1px solid #d1d5db;
      border-radius: 1rem;
      font-size: 0.9rem;
      outline: none;
      touch-action: manipulation;
      background-color: var(--text-light);
    }

    .chat-input button {
      padding: 0.6rem 1.5rem;
      margin-left: 0.5rem;
      background-color: var(--primary-blue);
      color: var(--text-light);
      border: none;
      border-radius: 1rem;
      cursor: pointer;
      font-size: 0.9rem;
      min-width: 90px;
      touch-action: manipulation;
      transition: background-color 0.2s, transform 0.1s;
    }

    .chat-input button:active {
      transform: scale(0.95);
    }

    .chat-input button:hover {
      background-color: #1e40af;
    }

    .chat-footer {
      background-color: var(--primary-blue);
      padding: 0.5rem;
      display: flex;
      justify-content: center;
      gap: 1.5rem;
      border-bottom-left-radius: 1.5rem;
      border-bottom-right-radius: 1.5rem;
      z-index: 10;
    }

    .footer-icon {
      color: var(--text-light);
      font-size: 1.25rem;
      text-decoration: none;
      padding: 0.4rem;
      border: 2px solid var(--text-light);
      border-radius: 0.5rem;
      transition: transform 0.2s, color 0.2s, border-color 0.2s;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      touch-action: manipulation;
    }

    .footer-icon:active {
      transform: scale(0.95);
    }

    .footer-icon:hover {
      color: var(--primary-yellow);
      border-color: var(--primary-yellow);
      transform: scale(1.1);
    }

    .footer-icon .tooltip {
      visibility: hidden;
      background-color: #374151;
      color: var(--text-light);
      text-align: center;
      border-radius: 0.25rem;
      padding: 0.25rem 0.5rem;
      position: absolute;
      z-index: 1;
      bottom: 125%;
      left: 50%;
      transform: translateX(-50%);
      font-size: 0.75rem;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .footer-icon:hover .tooltip {
      visibility: visible;
      opacity: 1;
    }

    .chat-toggle {
      position: fixed;
      bottom: 40px;
      right: 40px;
      background-color: var(--primary-blue);
      color: var(--text-light);
      width: 50px;
      height: 50px;
      border-radius: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      cursor: pointer;
      box-shadow: var(--shadow);
      transition: background-color 0.2s, transform 0.2s;
      z-index: 1000;
      touch-action: manipulation;
    }

    .chat-toggle.hidden {
      display: none;
    }

    .chat-toggle:active {
      transform: scale(0.95);
    }

    .chat-toggle:hover {
      background-color: #1e40af;
      transform: scale(1.1);
    }

    .keyboard {
      display: none;
      background-color: var(--keyboard-bg);
      padding: 0.3rem;
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 20;
      flex-wrap: wrap;
      gap: 0.2rem;
    }

    .keyboard-key {
      flex: 1 1 auto;
      padding: 0.4rem;
      background-color: var(--key-bg);
      border: 1px solid #d1d5db;
      border-radius: 0.25rem;
      text-align: center;
      font-size: 0.9rem;
      cursor: pointer;
      touch-action: manipulation;
      transition: background-color 0.2s;
      min-width: 10%;
      max-width: 15%;
    }

    .keyboard-key:active {
      background-color: var(--key-hover);
    }

    .keyboard-key:hover {
      background-color: var(--key-hover);
    }

    .keyboard-key.special {
      min-width: 20%;
    }

    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }

    .modal-content {
      background-color: var(--text-light);
      padding: 1rem;
      border-radius: 1rem;
      width: 90%;
      max-width: 400px;
      box-shadow: var(--shadow);
    }

    .modal-content h2 {
      font-size: 1.25rem;
      margin-bottom: 0.75rem;
      color: var(--primary-blue);
    }

    .modal-content label {
      display: block;
      margin-bottom: 0.5rem;
      font-size: 0.9rem;
      color: var(--text-dark);
    }

    .modal-content input,
    .modal-content select {
      width: 100%;
      padding: 0.6rem;
      margin-bottom: 0.75rem;
      border: 1px solid #d1d5db;
      border-radius: 0.25rem;
      font-size: 0.9rem;
    }

    .modal-content button {
      padding: 0.6rem 1.5rem;
      background-color: var(--primary-blue);
      color: var(--text-light);
      border: none;
      border-radius: 0.25rem;
      cursor: pointer;
      font-size: 0.9rem;
      transition: background-color 0.2s, transform 0.1s;
    }

    .modal-content button:active {
      transform: scale(0.95);
    }

    .modal-content button:hover {
      background-color: #1e40af;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes openChat {
      from { opacity: 0; transform: scale(0.8); }
      to { opacity: 1; transform: scale(1); }
    }

    @keyframes dots {
      0% { content: '.'; }
      33% { content: '..'; }
      66% { content: '...'; }
    }

    @media (max-width: 600px) {
      body {
        margin: 0;
        padding: 0;
        height: 100vh;
        overflow: hidden;
      }

      .chat-container {
        max-width: 90vw;
        width: 90vw;
        height: 90vh;
        border-radius: 1rem;
        margin: 5vh auto;
        padding: 0;
        position: fixed;
        top: 0;
        left: 5vw;
      }

      .chat-header {
        font-size: 1rem;
        padding: 0.5rem;
      }

      .chat-header .close-header {
        display: block;
      }

      .chat-messages {
        font-size: 0.85rem;
        padding-bottom: 120px;
      }

      .quick-replies {
        max-height: 40px;
        gap: 0.3rem;
        padding: 0.3rem 0.5rem;
      }

      .quick-reply {
        font-size: 0.7rem;
        padding: 0.25rem 0.6rem;
      }

      .chat-input {
        position: fixed;
        bottom: 150px;
        left: 5vw;
        right: 5vw;
        padding: 0.4rem;
      }

      .chat-input input {
        padding: 0.5rem;
      }

      .chat-input button {
        padding: 0.5rem 1.2rem;
        min-width: 80px;
      }

      .chat-footer {
        position: fixed;
        bottom: 0;
        left: 5vw;
        right: 5vw;
        gap: 1rem;
        padding: 0.4rem;
      }

      .footer-icon {
        font-size: 1.1rem;
        width: 32px;
        height: 32px;
      }

      .chat-toggle {
        bottom: 20px;
        right: 20px;
      }

      .chat-toggle:not(.hidden) + .chat-container:not(.hidden) ~ .chat-toggle {
        display: none;
      }

      .keyboard {
        display: flex;
        flex-wrap: wrap;
        gap: 0.2rem;
        padding: 0.3rem;
        height: 150px;
        position: fixed;
        bottom: 0;
        left: 5vw;
        right: 5vw;
      }

      .keyboard-key {
        font-size: 0.85rem;
        padding: 0.3rem;
      }
    }

    /* Accessibility */
    .chat-input input:focus,
    .chat-input button:focus,
    .quick-reply:focus,
    .footer-icon:focus,
    .modal-content input:focus,
    .modal-content button:focus,
    .chat-toggle:focus,
    .keyboard-key:focus,
    .close-header:focus {
      outline: 2px solid var(--primary-yellow);
      outline-offset: 2px;
    }
  </style>
</head>
<body>
  <div class="chat-toggle" id="chatToggle" aria-label="Open chatbot">
    <i class="fas fa-message"></i>
  </div>

  <div class="chat-container hidden" id="chatContainer" role="region" aria-label="Surprise Granite AI Chatbot">
    <div class="chat-header">
      <img src="https://cdn.prod.website-files.com/6456ce4476abb25581fbad0c/64a70d4b30e87feb388f004f_surprise-granite-profile-logo.svg" alt="Surprise Granite Logo">
      Surprise Granite AI
      <i class="fas fa-times close-header" onclick="toggleChat()" aria-label="Close chatbot"></i>
    </div>
    <div class="chat-messages" id="chatMessages" aria-live="polite">
      <div class="message bot">
        Welcome to Surprise Granite! How can I assist you today? Ask about our products, explore options, or book an appointment.
        <div class="timestamp" id="welcomeTimestamp"></div>
      </div>
    </div>
    <div class="quick-replies" id="quickReplies">
      <button class="quick-reply" onclick="sendQuickReply('Show products')">Products</button>
      <button class="quick-reply" onclick="sendQuickReply('Explore options')">Explore</button>
      <button class="quick-reply" onclick="openAppointmentModal()">Book Appointment</button>
    </div>
    <div class="chat-input">
      <input type="text" id="userInput" placeholder="Ask about Frost-N pricing..." aria-label="Chat input" autocomplete="off">
      <button onclick="sendMessage()" aria-label="Send message">Send</button>
    </div>
    <div class="keyboard" id="keyboard">
      <!-- Populated by JavaScript -->
    </div>
    <div class="chat-footer" id="chatFooter">
      <!-- Populated by JavaScript -->
    </div>
  </div>

  <div class="modal" id="appointmentModal">
    <div class="modal-content">
      <h2>Book an Appointment</h2>
      <form id="appointmentForm" action="https://usebasin.com/f/0e1679dd8d79" method="POST">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" required aria-required="true">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required aria-required="true">
        <label for="date">Preferred Date</label>
        <input type="date" id="date" name="date" required aria-required="true">
        <button type="submit">Submit</button>
        <button type="button" onclick="closeAppointmentModal()">Cancel</button>
      </form>
    </div>
  </div>

  <script>
    const chatContainer = document.getElementById('chatContainer');
    const chatToggle = document.getElementById('chatToggle');
    const chatMessages = document.getElementById('chatMessages');
    const userInput = document.getElementById('userInput');
    const quickReplies = document.getElementById('quickReplies');
    const appointmentModal = document.getElementById('appointmentModal');
    const chatFooter = document.getElementById('chatFooter');
    const keyboard = document.getElementById('keyboard');
    const sessionId = 'chat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    let placeholders = [
      'Ask about Frost-N pricing...',
      'Need a sink recommendation?',
      'Get a countertop quote...',
      'Book an appointment!'
    ];
    let placeholderIndex = 0;
    let inactivityTimer;
    let abandonTimer;
    let isShift = false;
    const isMobile = window.innerWidth <= 600;

    // Navigation links (for quick replies only)
    const NAV_LINKS = {
      samples: 'https://store.surprisegranite.com/collections/countertop-samples',
      vendors: 'https://www.surprisegranite.com/company/vendors-list',
      visualizer: 'https://www.surprisegranite.com/tools/virtual-kitchen-design-tool',
      countertops: 'https://www.surprisegranite.com/materials/all-countertops',
      store: 'https://store.surprisegranite.com/'
    };

    // Initialize keyboard (mobile only)
    function initKeyboard() {
      if (!isMobile) {
        keyboard.style.display = 'none';
        return;
      }
      const keys = [
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
        'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p',
        'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l',
        'shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace',
        'space', 'enter'
      ];
      keyboard.innerHTML = keys.map(key => `
        <button class="keyboard-key ${key === 'shift' || key === 'backspace' || key === 'space' || key === 'enter' ? 'special' : ''}" data-key="${key}">
          ${key === 'backspace' ? '<i class="fas fa-backspace"></i>' : key === 'space' ? ' ' : key === 'enter' ? '<i class="fas fa-paper-plane"></i>' : key}
        </button>
      `).join('');
      keyboard.querySelectorAll('.keyboard-key').forEach(key => {
        key.addEventListener('click', handleKeyPress);
      });
    }

    function handleKeyPress(e) {
      const key = e.target.dataset.key;
      if (key === 'shift') {
        isShift = !isShift;
        keyboard.querySelectorAll('.keyboard-key:not(.special)').forEach(k => {
          k.textContent = isShift ? k.textContent.toUpperCase() : k.textContent.toLowerCase();
        });
        return;
      }
      if (key === 'backspace') {
        userInput.value = userInput.value.slice(0, -1);
        return;
      }
      if (key === 'space') {
        userInput.value += ' ';
        return;
      }
      if (key === 'enter') {
        sendMessage();
        return;
      }
      userInput.value += isShift ? key.toUpperCase() : key;
    }

    // Load company info
    async function loadCompanyInfo() {
      try {
        const response = await fetch('/companyInfo.json');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: Failed to fetch companyInfo.json`);
        }
        const companyInfo = await response.json();
        console.log('Company info loaded:', companyInfo);
        chatFooter.innerHTML = `
          <a href="tel:${companyInfo.phone || '+16028333189'}" class="footer-icon" aria-label="Call us" title="Call">
            <i class="fas fa-phone"></i>
            <span class="tooltip">Call Us</span>
          </a>
          <a href="${companyInfo.messageForm || 'https://usebasin.com/f/0e1679dd8d79'}" class="footer-icon" aria-label="Message us" title="Message" target="_blank" rel="noopener noreferrer">
            <i class="fas fa-envelope"></i>
            <span class="tooltip">Message Us</span>
          </a>
          <a href="${companyInfo.mapUrl || 'https://maps.google.com/?q=11560+N+Dysart+Rd,+Surprise,+AZ+85379'}" class="footer-icon" aria-label="Get directions" title="Directions" target="_blank" rel="noopener noreferrer">
            <i class="fas fa-map-marker-alt"></i>
            <span class="tooltip">Get Directions</span>
          </a>
        `;
      } catch (error) {
        console.error('Error loading company info:', error.message);
        chatFooter.innerHTML = `
          <a href="tel:+16028333189" class="footer-icon" aria-label="Call us" title="Call">
            <i class="fas fa-phone"></i>
            <span class="tooltip">Call Us</span>
          </a>
          <a href="https://usebasin.com/f/0e1679dd8d79" class="footer-icon" aria-label="Message us" title="Message" target="_blank" rel="noopener noreferrer">
            <i class="fas fa-envelope"></i>
            <span class="tooltip">Message Us</span>
          </a>
          <a href="https://maps.google.com/?q=11560+N+Dysart+Rd,+Surprise,+AZ+85379" class="footer-icon" aria-label="Get directions" title="Directions" target="_blank" rel="noopener noreferrer">
            <i class="fas fa-map-marker-alt"></i>
            <span class="tooltip">Get Directions</span>
          </a>
        `;
      }
    }

    // Set timestamp for welcome message
    document.getElementById('welcomeTimestamp').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Rotate placeholders
    setInterval(() => {
      userInput.placeholder = placeholders[placeholderIndex];
      placeholderIndex = (placeholderIndex + 1) % placeholders.length;
    }, 3000);

    // Auto-focus input
    userInput.focus();

    // Open samples page
    function openSamples() {
      console.log('Samples button clicked, redirecting to:', NAV_LINKS.samples);
      try {
        window.open(NAV_LINKS.samples, '_blank');
      } catch (error) {
        console.error('Failed to open samples page:', error);
        addMessage('Sorry, I couldn’t open the samples page.', false);
      }
    }

    // Inactivity detection
    function resetInactivityTimer() {
      clearTimeout(inactivityTimer);
      clearTimeout(abandonTimer);
      inactivityTimer = setTimeout(() => {
        addMessage('Are you still there? Let me know how I can assist!', false, null, null, ['Products', 'Explore', 'Book Appointment']);
        abandonTimer = setTimeout(closeAbandonedChat, 60 * 1000);
      }, 5 * 60 * 1000);
    }

    async function closeAbandonedChat() {
      addMessage('Chat session closed due to inactivity.', false);
      chatContainer.classList.add('hidden');
      chatToggle.innerHTML = '<i class="fas fa-message"></i>';
      chatToggle.setAttribute('aria-label', 'Open chatbot');
      chatToggle.classList.remove('hidden');
      if (isMobile) keyboard.style.display = 'none';
      try {
        await fetch('https://surprise-granite-connections-dev.onrender.com/api/close-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, abandoned: true })
        });
      } catch (error) {
        console.error('Error closing chat:', error);
      }
      clearTimeout(inactivityTimer);
      clearTimeout(abandonTimer);
    }

    // Toggle chatbot
    function toggleChat() {
      const isHidden = chatContainer.classList.contains('hidden');
      chatContainer.classList.toggle('hidden', !isHidden);
      chatToggle.innerHTML = isHidden ? '<i class="fas fa-message"></i>' : '<i class="fas fa-message"></i>';
      chatToggle.setAttribute('aria-label', isHidden ? 'Close chatbot' : 'Open chatbot');
      if (isHidden) {
        userInput.focus();
        if (isMobile) {
          keyboard.style.display = 'flex';
          userInput.setAttribute('readonly', 'readonly');
          userInput.scrollIntoView({ behavior: 'smooth', block: 'end' });
          chatToggle.classList.add('hidden');
          document.documentElement.requestFullscreen().catch(err => console.error('Fullscreen error:', err));
        } else {
          userInput.removeAttribute('readonly');
          keyboard.style.display = 'none';
        }
        resetInactivityTimer();
      } else {
        clearTimeout(inactivityTimer);
        clearTimeout(abandonTimer);
        if (isMobile) {
          keyboard.style.display = 'none';
          chatToggle.classList.remove('hidden');
          if (document.fullscreenElement) document.exitFullscreen();
        }
        fetch('https://surprise-granite-connections-dev.onrender.com/api/close-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, abandoned: false })
        }).catch(error => console.error('Error closing chat:', error));
      }
    }

    chatToggle.addEventListener('click', toggleChat);

    function addMessage(content, isUser, imageUrl, productUrl, quickRepliesList) {
      const div = document.createElement('div');
      div.className = `message ${isUser ? 'user' : 'bot'}`;
      
      const contentDiv = document.createElement('div');
      contentDiv.innerHTML = content; // Supports hyperlinks

      div.appendChild(contentDiv);

      if (imageUrl && !isUser) {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = `Product image`;
        div.appendChild(img);
      }

      const timestamp = document.createElement('div');
      timestamp.className = 'timestamp';
      timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      div.appendChild(timestamp);

      chatMessages.appendChild(div);

      // Update quick replies
      if (quickRepliesList && quickRepliesList.length) {
        quickReplies.innerHTML = quickRepliesList.map(reply => {
          let action = `sendQuickReply('${reply}')`;
          if (reply === 'Samples') action = `openSamples()`;
          if (reply === 'Book Appointment') action = `openAppointmentModal()`;
          if (reply === 'Online Store') action = `window.open('${NAV_LINKS.store}', '_blank')`;
          return `<button class="quick-reply" onclick="${action}">${reply}</button>`;
        }).join('');
      }

      chatMessages.scrollTop = chatMessages.scrollHeight;

      if (isUser) resetInactivityTimer();
    }

    function showTypingIndicator(show) {
      let indicator = document.getElementById('typingIndicator');
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'typingIndicator';
        indicator.className = 'typing-indicator';
        indicator.textContent = 'Surprise Granite AI is typing';
        chatMessages.appendChild(indicator);
      }
      indicator.style.display = show ? 'block' : 'none';
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function sendMessage() {
      const message = userInput.value.trim();
      if (!message) return;

      addMessage(message, true);
      userInput.value = '';
      quickReplies.style.display = 'none';
      showTypingIndicator(true);

      try {
        const response = await fetch('https://surprise-granite-connections-dev.onrender.com/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, sessionId })
        });
        const data = await response.json();
        showTypingIndicator(false);
        addMessage(data.message, false, data.image, data.productUrl, data.quickReplies || ['Products', 'Explore', 'Book Appointment']);
        quickReplies.style.display = 'flex';
      } catch (error) {
        console.error('Chat error:', error);
        showTypingIndicator(false);
        addMessage('Sorry, something went wrong. Please try again.', false, null, null, ['Products', 'Explore', 'Book Appointment']);
        quickReplies.style.display = 'flex';
      }
    }

    function sendQuickReply(message) {
      let query = message;
      if (message === 'Products') query = 'Show products';
      if (message === 'Explore') query = 'Explore options';
      userInput.value = query;
      sendMessage();
    }

    function openAppointmentModal() {
      appointmentModal.style.display = 'flex';
      document.getElementById('name').focus();
      if (isMobile) keyboard.style.display = 'none';
    }

    function closeAppointmentModal() {
      appointmentModal.style.display = 'none';
      document.getElementById('appointmentForm').reset();
      if (isMobile) keyboard.style.display = 'flex';
    }

    async function handleAppointmentSubmit(e) {
      e.preventDefault();
      const name = document.getElementById('name').value;
      const email = document.getElementById('email').value;
      const date = document.getElementById('date').value;

      try {
        const form = document.getElementById('appointmentForm');
        const response = await fetch(form.action, {
          method: 'POST',
          body: new FormData(form),
        });
        if (response.ok) {
          addMessage(`Appointment booked for ${name} on ${date}! We'll confirm via email.`, false);
          let chatLog = await ChatLog.findOne({ sessionId });
          if (!chatLog) {
            chatLog = new ChatLog({ sessionId, messages: [] });
          }
          chatLog.appointmentRequested = true;
          chatLog.messages.push({
            role: 'system',
            content: `Appointment requested: ${name}, ${email}, ${date}`,
          });
          await chatLog.save();
        } else {
          throw new Error('Basin submission failed');
        }
        closeAppointmentModal();
      } catch (error) {
        console.error('Appointment error:', error);
        addMessage('Sorry, we couldn’t book your appointment. Please try again.', false);
      }
    }

    userInput.addEventListener('click', () => {
      if (isMobile) {
        keyboard.style.display = 'flex';
        userInput.setAttribute('readonly', 'readonly');
        userInput.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } else {
        userInput.removeAttribute('readonly');
        keyboard.style.display = 'none';
      }
    });

    userInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    document.getElementById('appointmentForm').addEventListener('submit', handleAppointmentSubmit);

    // Initialize company info and keyboard
    loadCompanyInfo();
    initKeyboard();
  </script>
</body>
</html>
