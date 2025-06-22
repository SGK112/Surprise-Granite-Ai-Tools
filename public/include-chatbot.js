<!-- Surprise Granite Wizard AI Chatbot Include File -->
<!-- Include this file on any web page to add the chatbot functionality -->

<!-- Add the chatbot container -->
<div id="sg-chatbot-container"></div>

<!-- Load the necessary scripts -->
<script>
  (function() {
    console.log("Chatbot include script starting...");
    
    // Create link to load styles
    const styles = document.createElement('link');
    styles.rel = 'stylesheet';
    styles.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap';
    document.head.appendChild(styles);

    const fontAwesome = document.createElement('link');
    fontAwesome.rel = 'stylesheet';
    fontAwesome.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    document.head.appendChild(fontAwesome);

    // Load particles.js
    const particles = document.createElement('script');
    particles.src = 'https://cdn.jsdelivr.net/npm/particles.js@2.0.0/particles.min.js';
    particles.onload = () => console.log("Particles.js loaded");
    particles.onerror = (err) => console.error("Error loading particles.js:", err);
    document.head.appendChild(particles);

    // Function to load the chatbot
    function loadChatbot() {
      console.log("Loading chatbot...");
      const container = document.getElementById('sg-chatbot-container');
      if (!container) {
        console.error("Container element not found!");
        return;
      }
      
      // Create an iframe for the chatbot
      const iframe = document.createElement('iframe');
      iframe.src = '/sg-chatbot-widget.html'; // Direct reference
      iframe.style.position = 'fixed';
      iframe.style.bottom = '0';
      iframe.style.right = '0';
      iframe.style.border = '2px solid blue'; // Visible border for debugging
      iframe.style.width = '450px';
      iframe.style.height = '600px';
      iframe.style.maxHeight = '80vh';
      iframe.style.maxWidth = '95vw';
      iframe.style.zIndex = '9999';
      iframe.style.display = 'block'; // Show by default during testing
      iframe.id = 'sg-chatbot-iframe';
      
      // Add load and error handlers
      iframe.onload = () => {
        console.log("Chatbot iframe loaded successfully");
      };
      iframe.onerror = (err) => {
        console.error("Error loading chatbot iframe:", err);
      };
      
      container.appendChild(iframe);
      console.log("Iframe added to container");
      
      // Create toggle button
      const toggleBtn = document.createElement('button');
      toggleBtn.innerHTML = '<i class="fas fa-hat-wizard"></i>';
      toggleBtn.style.position = 'fixed';
      toggleBtn.style.bottom = '15px';
      toggleBtn.style.right = '15px';
      toggleBtn.style.background = 'linear-gradient(135deg, #1e2749 60%, #feda00 100%)';
      toggleBtn.style.color = '#fff';
      toggleBtn.style.width = '60px'; // Increased size
      toggleBtn.style.height = '60px'; // Increased size
      toggleBtn.style.borderRadius = '50%';
      toggleBtn.style.display = 'flex';
      toggleBtn.style.alignItems = 'center';
      toggleBtn.style.justifyContent = 'center';
      toggleBtn.style.fontSize = '1.8rem'; // Increased size
      toggleBtn.style.cursor = 'pointer';
      toggleBtn.style.boxShadow = '0 4px 24px 0 #1e274988, 0 1.5px 8px 0 #feda0044';
      toggleBtn.style.border = '3px solid #feda00'; // More visible border
      toggleBtn.style.zIndex = '10000';
      toggleBtn.style.transition = 'all 0.3s';
      
      toggleBtn.addEventListener('click', function() {
        console.log("Toggle button clicked");
        const iframe = document.getElementById('sg-chatbot-iframe');
        if (!iframe) {
          console.error("Iframe not found!");
          return;
        }
        
        if (iframe.style.display === 'none') {
          iframe.style.display = 'block';
          toggleBtn.innerHTML = '<i class="fas fa-times"></i>';
          console.log("Chatbot opened");
        } else {
          iframe.style.display = 'none';
          toggleBtn.innerHTML = '<i class="fas fa-hat-wizard"></i>';
          console.log("Chatbot closed");
        }
      });
      
      container.appendChild(toggleBtn);
      console.log("Toggle button added");
    }

    // Add debug button
    function addDebugButton() {
      const debugBtn = document.createElement('button');
      debugBtn.innerHTML = 'Debug Chatbot';
      debugBtn.style.position = 'fixed';
      debugBtn.style.top = '15px';
      debugBtn.style.right = '15px';
      debugBtn.style.padding = '10px';
      debugBtn.style.background = '#f0f0f0';
      debugBtn.style.border = '1px solid #ccc';
      debugBtn.style.borderRadius = '5px';
      debugBtn.style.zIndex = '10001';
      
      debugBtn.addEventListener('click', function() {
        console.log('Debug button clicked');
        const container = document.getElementById('sg-chatbot-container');
        console.log('Container exists:', !!container);
        
        const iframe = document.getElementById('sg-chatbot-iframe');
        console.log('Iframe exists:', !!iframe);
        
        if (iframe) {
          console.log('Iframe display style:', iframe.style.display);
          console.log('Iframe src:', iframe.src);
          
          // Force show the iframe
          iframe.style.display = 'block';
          console.log('Forced iframe to show');
        } else {
          // If iframe doesn't exist, create it again
          loadChatbot();
        }
      });
      
      document.body.appendChild(debugBtn);
      console.log("Debug button added");
    }
    
    // Add the debug button to help diagnose issues
    addDebugButton();

    // Load the chatbot when everything is ready
    if (document.readyState === 'complete') {
      loadChatbot();
    } else {
      window.addEventListener('load', loadChatbot);
    }
    
    console.log("Chatbot include script completed");
  })();
</script>
