# Firebase Auth セットアップ手順

このアプリは **Firebase Authentication（Google サインイン）** を使います。コードは環境変数（プレースホルダ）で実装済みのため、Firebase プロジェクトを作成し、設定値を投入すれば動作します。

## 1. Firebase プロジェクト作成 & Google サインイン有効化
1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成
2. **Authentication → Sign-in method** で **Google** を有効化
3. **Authentication → Settings → Authorized domains** に開発/本番ドメインを追加（例: `localhost`、本番ドメイン）
4. **プロジェクトの設定 → マイアプリ → Web アプリ**を追加し、`firebaseConfig` の値を取得

## 2. フロントエンド（`apps/web`）の環境変数
`apps/web/.env.local`（gitignore 済み・コミットしない）に Web 設定を記載します。`NEXT_PUBLIC_*` はビルド時にクライアントへ注入されます。

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=<project-id>
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=<project-id>.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
# 任意: クライアントから API を直接叩く場合のベースURL（例 http://localhost:8787）
NEXT_PUBLIC_API_BASE_URL=
```

> 設定が未投入の間は、ログイン画面に「未設定」と表示され、保護ルートは素通り（開発用）になります。本番では必ず設定してください。

## 3. バックエンド（`apps/api`）のプロジェクトID
ID トークン検証にプロジェクトIDを使います。`apps/api/wrangler.json` の `vars.FIREBASE_PROJECT_ID`（現在 `your-firebase-project-id`）を実際のプロジェクトIDに置き換えます。公開鍵は KV にキャッシュされます（`KV` バインディング使用）。

- 公開値のため `vars` で問題ありません（秘匿が必要な値ではありません）。
- 本番でも同様に `wrangler.json` の値を設定してデプロイします。

## 4. 認証フローの仕組み
- フロント: `lib/firebase.ts`（遅延初期化）＋ `lib/auth-context.tsx`（`useAuth`: Google サインイン/サインアウト/状態）
- 保護ルート: `components/auth/require-auth.tsx` がフロー画面（`/destination` 〜 `/itinerary`）をラップし、未ログインは `/login` へ誘導
- API 呼び出し: `lib/api.ts` の `apiFetch` が `Authorization: Bearer <idToken>` を付与
- API: `middleware/auth.ts` がトークンを検証し `c.get("user")` で `uid`/`email` を解決。`GET /me` は認証必須で `users` を upsert

## 5. 動作確認
1. `apps/web/.env.local` と `wrangler.json` の `FIREBASE_PROJECT_ID` を設定
2. `pnpm dev` で起動し、`/login` から Google ログイン
3. ログイン後にフロー画面へアクセスできること、`GET /me` が `uid` を返すことを確認
