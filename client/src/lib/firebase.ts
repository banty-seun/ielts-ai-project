import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, sendEmailVerification, ActionCodeSettings } from "firebase/auth";

// The correct Firebase project ID is "ielts-ai-a0f3b" as specified
// We need to ensure we're using the same project ID as the server
const projectId = 'ielts-ai-a0f3b';

// Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: `${projectId}.firebaseapp.com`,
  projectId: projectId,
  storageBucket: `${projectId}.appspot.com`,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
const auth = getAuth(app);

// Email verification settings
// Always use the current origin to avoid redirecting to a different domain
// This ensures we stay in the same session context
const actionCodeSettings: ActionCodeSettings = {
  url: window.location.origin + '/verify-handler',
  handleCodeInApp: true,
  // Don't use iOS or Android settings to keep it browser-based
};

export { 
  app, 
  auth, 
  createUserWithEmailAndPassword, 
  sendEmailVerification,
  actionCodeSettings 
};