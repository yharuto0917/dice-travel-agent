import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import { type Auth, getAuth } from "firebase/auth";

// Firebase の Web 設定（公開値。NEXT_PUBLIC_* でビルド時に注入）
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** 必須設定が揃っているか（未設定なら UI 側でログインを無効表示にする） */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

let cachedAuth: Auth | null = null;

/** クライアントでのみ呼び出す。Firebase Auth を遅延初期化して返す。 */
export function getFirebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  const app: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);
  cachedAuth = getAuth(app);
  return cachedAuth;
}
