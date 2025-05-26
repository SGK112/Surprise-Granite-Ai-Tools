// Surprise Granite Chatbot Widget (Resting Icon, Branded Colors)
(function () {
  if (window.SGChatbotLoaded) return;
  window.SGChatbotLoaded = true;

  // Brand colors
  const brandBlue = "#2e3547";
  const brandYellow = "#ffe14d";

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    #sgcb-btn {
      position: fixed; bottom: 32px; right: 32px; z-index: 999999;
      width: 64px; height: 64px; border-radius: 50%; border: none;
      background: ${brandYellow};
      box-shadow: 0 4px 24px rgba(0,0,0,0.13);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: box-shadow 0.2s;
      color: ${brandBlue}; font-size: 32px;
      border: 4px solid ${brandBlue};
    }
    #sgcb-btn:hover { box-shadow: 0 8px 32px rgba(0,0,0,0.22);}
    #sgcb-iframe {
      position: fixed; bottom: 104px; right: 32px; z-index: 999999;
      width: 400px; max-width: 99vw; height: 560px; max-height: 85vh;
      border: none; border-radius: 18px; background: transparent;
      box-shadow: 0 8px 40px rgba(20,24,40,0.17);
      display: none; opacity: 0; transition: opacity 0.15s;
    }
    #sgcb-iframe.open { display: block; opacity: 1;}
    @media (max-width: 600px) {
      #sgcb-iframe { width: 99vw; height: 97vh; right: 0; bottom: 0; border-radius: 0; }
      #sgcb-btn { right: 18px; bottom: 18px; }
    }
  `;
  document.head.appendChild(style);

  // Button
  const btn = document.createElement('button');
  btn.id = 'sgcb-btn';
  btn.title = 'Chat with Surprise Granite';
  btn.innerHTML = `
    <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
      <circle cx="19" cy="19" r="19" fill="${brandBlue}"/>
      <path d="M19 11C14.6 11 11 14.13 11 18c0 1.02.28 2 .8 2.87l-.77 3.04a1 1 0 0 0 1.25 1.22l3.19-.84A11.4 11.4 0 0 0 19 24c4.4 0 8-3.13 8-7s-3.6-6-8-6Z" fill="${brandYellow}"/>
      <circle cx="15.5" cy="18" r="1.1" fill="${brandBlue}"/>
      <circle cx="19" cy="18" r="1.1" fill="${brandBlue}"/>
      <circle cx="22.5" cy="18" r="1.1" fill="${brandBlue}"/>
    </svg>
  `;
  document.body.appendChild(btn);

  // Iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'sgcb-iframe';
  iframe.allow = 'clipboard-write; camera; microphone';
  iframe.src = '/chatbot.html';
  document.body.appendChild(iframe);

  // Toggle logic
  btn.onclick = function () {
    if (iframe.classList.contains('open')) {
      iframe.classList.remove('open');
      setTimeout(() => { iframe.style.display = 'none'; }, 180);
    } else {
      iframe.style.display = 'block';
      setTimeout(() => { iframe.classList.add('open'); }, 12);
    }
  };

  // Listen for close event from iframe
  window.addEventListener('message', function (e) {
    if (e.data && e.data.sgChatbotClose) {
      iframe.classList.remove('open');
      setTimeout(() => { iframe.style.display = 'none'; }, 180);
    }
  });

  // Hide on ESC
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && iframe.classList.contains('open')) {
      iframe.classList.remove('open');
      setTimeout(() => { iframe.style.display = 'none'; }, 180);
    }
  });
})();
