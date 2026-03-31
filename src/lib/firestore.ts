import { db, isFirebaseConfigured } from './firebase';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  Timestamp
} from 'firebase/firestore';

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  timestamp: Date;
  model: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  attachments?: any[];
}

const CONVERSATIONS_SUBCOLLECTION = 'conversations';

function isReady(): boolean {
  return isFirebaseConfigured && db !== null;
}

/**
 * Save a conversation to Firestore under users/{uid}/conversations/{convId}
 */
export async function saveConversation(
  userId: string,
  conversation: Conversation
): Promise<void> {
  if (!isReady()) return;
  const docRef = doc(db!, 'users', userId, CONVERSATIONS_SUBCOLLECTION, conversation.id);
  const dataToSave = {
    ...conversation,
    timestamp: Timestamp.fromDate(new Date(conversation.timestamp)),
  };
  await setDoc(docRef, dataToSave, { merge: true });
}

/**
 * Load all conversations for a user from Firestore
 */
export async function loadConversations(userId: string): Promise<Conversation[]> {
  if (!isReady()) return [];
  const q = query(
    collection(db!, 'users', userId, CONVERSATIONS_SUBCOLLECTION),
    orderBy('timestamp', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title || '',
      messages: data.messages || [],
      timestamp: data.timestamp?.toDate() || new Date(),
      model: data.model || 'sz-sonnet-4',
    } as Conversation;
  });
}

/**
 * Delete a single conversation
 */
export async function deleteConversation(
  userId: string,
  conversationId: string
): Promise<void> {
  if (!isReady()) return;
  await deleteDoc(doc(db!, 'users', userId, CONVERSATIONS_SUBCOLLECTION, conversationId));
}

/**
 * Delete all conversations for a user
 */
export async function clearAllConversations(userId: string): Promise<void> {
  if (!isReady()) return;
  const q = query(collection(db!, 'users', userId, CONVERSATIONS_SUBCOLLECTION));
  const snapshot = await getDocs(q);
  const promises = snapshot.docs.map(d =>
    deleteDoc(doc(db!, 'users', userId, CONVERSATIONS_SUBCOLLECTION, d.id))
  );
  await Promise.all(promises);
}
