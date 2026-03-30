import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "REDACTED",
  authDomain: "REDACTED",
  projectId: "unlimited-claude-ai",
  storageBucket: "REDACTED",
  messagingSenderId: "REDACTED",
  appId: "1:REDACTED:web:c26b86f7436b61c5a87d6f"
};

// Initialize Firebase (prevent re-initialization in dev mode)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const db = getFirestore(app);
export const auth = getAuth(app);

// Sign in anonymously and return the user ID
export async function ensureAuth(): Promise<string> {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (user) {
        resolve(user.uid);
      } else {
        try {
          const cred = await signInAnonymously(auth);
          resolve(cred.user.uid);
        } catch (err) {
          reject(err);
        }
      }
    });
  });
}
