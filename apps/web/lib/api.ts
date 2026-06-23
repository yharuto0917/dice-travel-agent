import { getFirebaseAuth, isFirebaseConfigured } from "./firebase";

// API ワーカーのベースURL（クライアントから直接叩く場合に使用。未設定なら相対）
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/** Firebase IDトークンを `Authorization` に付与する fetch ラッパー。 */
export async function apiFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (isFirebaseConfigured) {
    const current = getFirebaseAuth().currentUser;
    if (current) {
      headers.set("Authorization", `Bearer ${await current.getIdToken()}`);
    }
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}
