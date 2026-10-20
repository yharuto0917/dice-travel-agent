import path from "node:path";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { version } from "./package.json";

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // React Strict Mode（dev）は mount→unmount→mount の二重マウントを行う。
  // react-three-fiber の <Canvas>（特に @react-three/cannon の <Physics> を含む 3D シーン）は
  // この捨てマウントのクリーンアップで WebGLRenderer が forceContextLoss を呼び、
  // 再マウント時に同じ <canvas> 要素を再利用するため WebGL コンテキストを取得できず、
  // 3D（サイコロ・日本地図）が dev で永久に空白になる。
  // 3D 側だけの遅延マウント等では確実に回避できなかったため、dev の二重マウント自体を無効化する。
  // ※ これは dev 限定の挙動であり、本番ビルドには影響しない。
  reactStrictMode: false,
  // モノレポのため Turbopack のルートを明示（他のlockfile誤検出による警告を抑制）。
  // また、Cloudflare Workers（workerd）環境では実行時にファイルシステム（node:fs）から
  // Markdown ファイルを読み込めないため、ビルド時に raw 文字列モジュールとしてバンドルする。
  turbopack: {
    root: path.join(__dirname, "..", ".."),
    rules: {
      "*.md": {
        loaders: [path.join(__dirname, "lib", "raw-loader.cjs")],
        as: "*.js",
      },
    },
  },
  transpilePackages: ["@repo/shared"],
  // package.json の version をビルド時に注入し、UI でアプリのバージョンを表示する。
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
