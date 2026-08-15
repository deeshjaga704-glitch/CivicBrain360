import { createSupabaseBrowserClient } from './supabase';

export async function register(email: string, password: string, fullName: string) {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName, role: 'Citizen' } } });
  if (error) throw error;

  if (data.user) {
    await supabase.from('profiles').upsert({ id: data.user.id, full_name: fullName, role: 'Citizen' }).throwOnError();
  }

  return data;
}

export async function login(email: string, password: string) {
  const { data, error } = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function logout() {
  const { error } = await createSupabaseBrowserClient().auth.signOut();
  if (error) throw error;
}

export async function getCurrentProfile() {
  const supabase = createSupabaseBrowserClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data;
}
