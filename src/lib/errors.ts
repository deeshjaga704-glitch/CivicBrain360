export function userFacingError(error: unknown, fallback = 'Something went wrong. Please try again.') {
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login') || normalized.includes('invalid credentials')) return 'The email or password is incorrect.';
  if (normalized.includes('email not confirmed')) return 'Please confirm your email before signing in.';
  if (normalized.includes('already registered') || normalized.includes('already been registered')) return 'An account with this email already exists.';
  if (normalized.includes('login is required') || normalized.includes('sign in')) return 'Please sign in to continue.';
  if (normalized.includes('missing next_public_supabase')) return 'Supabase is not configured for this environment.';
  if (normalized.includes('unsupported evidence')) return 'That file type is not supported.';
  if (normalized.includes('exceeds 10 mb')) return 'Evidence files must be 10 MB or smaller.';
  if (normalized.includes('valid latitude') || normalized.includes('coordinates')) return 'Enter valid latitude and longitude values.';
  if (normalized.includes('category is required')) return 'Choose a complaint category.';
  if (normalized.includes('title is required')) return 'Enter a complaint title.';
  if (normalized.includes('description is required')) return 'Enter a complaint description.';
  if (normalized.includes('unauthorized') || normalized.includes('permission') || normalized.includes('role is required')) return 'You are not authorized to perform that action.';
  if (normalized.includes('network') || normalized.includes('fetch')) return 'The network is unavailable. Please try again.';
  return fallback;
}
