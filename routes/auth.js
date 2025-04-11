// Firebase configuration
const firebaseConfig = {
  apiKey: "FIREBASE_API_KEY",
  authDomain: "FIREBASE_AUTH_DOMAIN",
  projectId: "FIREBASE_PROJECT_ID",
  storageBucket: "FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
  appId: "FIREBASE_APP_ID",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

document.addEventListener('DOMContentLoaded', () => {
  const backendUrl = 'http://localhost:10000'; // Use your Render URL in production
  const loginLink = document.getElementById('login-link');
  const logoutLink = document.getElementById('logout-link');

  // Monitor auth state
  auth.onAuthStateChanged((user) => {
    if (user) {
      localStorage.setItem('firebaseToken', user.uid);
      if (loginLink) loginLink.style.display = 'none';
      if (logoutLink) logoutLink.style.display = 'inline';
      user.getIdToken().then((token) => {
        fetch(`${backendUrl}/api/v1/auth/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ email: user.email, name: user.displayName }),
        }).catch((error) => console.error('Sync error:', error));
      });
    } else {
      localStorage.removeItem('firebaseToken');
      if (loginLink) loginLink.style.display = 'inline';
      if (logoutLink) logoutLink.style.display = 'none';
    }
  });

  if (loginLink) {
    loginLink.addEventListener('click', (e) => {
      e.preventDefault();
      const provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithPopup(provider)
        .then((result) => {
          window.location.href = '/dashboard.html';
        })
        .catch((error) => {
          alert(`Login failed: ${error.message}`);
        });
    });
  }

  if (logoutLink) {
    logoutLink.addEventListener('click', (e) => {
      e.preventDefault();
      auth.signOut()
        .then(() => {
          window.location.href = '/';
        })
        .catch((error) => {
          alert(`Logout failed: ${error.message}`);
        });
    });
  }
});
