import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0',
  authDomain: 'open-notes-fake.firebaseapp.com',
  projectId: 'open-notes-fake',
  appId: '1:000000000000:web:fakefakefakefake',
});

export const auth = getAuth(app);
export const db = getFirestore(app);
