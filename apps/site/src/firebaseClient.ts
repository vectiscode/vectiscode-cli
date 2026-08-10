import { initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

let initialized = false;

export async function signInWithFirebaseGoogle(config: FirebaseOptions) {
  if (!initialized) {
    initializeApp(config);
    initialized = true;
  }

  const auth = getAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  const result = await signInWithPopup(auth, provider);
  return result.user.getIdToken();
}
