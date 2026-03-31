import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// Hardcoded Firebase config — NEXT_PUBLIC_* keys are inherently public (exposed in client bundle)
const firebaseConfig = {
  apiKey: 'AIzaSyD-AowFGYD9zxGQAaFWuGVMnoen_evi3gc',
  authDomain: 'unlimited-claude-ai.firebaseapp.com',
  projectId: 'unlimited-claude-ai',
  storageBucket: 'unlimited-claude-ai.firebasestorage.app',
  messagingSenderId: '137701934142',
  appId: '1:137701934142:web:c26b86f7436b61c5a87d6f',
};

let app = null;
let db = null;
let auth = null;

try {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app);
  auth = getAuth(app);
} catch (err) {
  console.warn('Firebase initialization failed:', err);
}

const isFirebaseConfigured = Boolean(db && auth);

export { db, auth, isFirebaseConfigured };

// Sign in anonymously and return the user ID. Returns null if Firebase is not configured.
export async function ensureAuth(): Promise<string | null> {
  if (!auth) return null;
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (user) {
        resolve(user.uid);
      } else {
        try {
          const cred = await signInAnonymously(auth);
          resolve(cred.user.uid);
        } catch (err) {
          console.warn('Firebase anonymous auth failed:', err);
          resolve(null);
        }
      }
    });
  });
}
