import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';

export function Admin() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    getDocs(collection(db, 'users')).then((s) => setUsers(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, []);
  return (
    <ul>
      {users.map((u) => (
        <li key={u.id}>
          {u.email} <button onClick={() => deleteDoc(doc(db, 'users', u.id))}>Delete</button>
        </li>
      ))}
    </ul>
  );
}

export function Profile({ uid }) {
  const [form, setForm] = useState({ displayName: '', role: 'user' });
  const save = () => setDoc(doc(db, 'users', uid), form, { merge: true });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
      <button>Save</button>
    </form>
  );
}

export function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState('user');
  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u);
    if (u) setRole((await getDoc(doc(db, 'users', u.uid))).data()?.role ?? 'user');
  }), []);

  if (!user) return <p>Please sign in</p>;
  if (window.location.pathname === '/admin') {
    return role === 'admin' ? <Admin /> : <p>Not allowed</p>;
  }
  return <Profile uid={user.uid} />;
}
