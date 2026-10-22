import { useAuth } from '@clerk/react';
import { useLocation } from 'wouter';

/** Runs `fn` only when signed in; otherwise opens the sign-in overlay. */
export function useGate() {
  const { isSignedIn, isLoaded } = useAuth();
  const [, nav] = useLocation();
  const gate = (fn: () => void) => () => (isSignedIn ? fn() : nav('/sign-in'));
  return { signedIn: !!isSignedIn, loaded: isLoaded, gate, run: (fn: () => void) => (isSignedIn ? fn() : nav('/sign-in')) };
}
