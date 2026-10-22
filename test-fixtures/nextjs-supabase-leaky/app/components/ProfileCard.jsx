'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

export function ProfileCard({ id }) {
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', id).single().then(({ data }) => setProfile(data));
  }, [id]);
  if (!profile) return null;
  return (
    <section>
      <h2>{profile.name}</h2>
      <div dangerouslySetInnerHTML={{ __html: profile.bio }} />
    </section>
  );
}
