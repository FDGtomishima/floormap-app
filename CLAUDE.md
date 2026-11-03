# フロアマップ作成アプリ

区画番号入りのフロア画像（図面）を読み込み、区画をタップすると店舗の詳細が見られるフロアマップを作成・公開するWebアプリ。
管理者はPCで作成し、閲覧者はスマホでQRコードまたはマップコードから開く。個人開発。

## 最初に読むもの

| ファイル | 内容 |
| --- | --- |
| `docs/01_spec.md` | 仕様書（目的、機能一覧、画面構成、データ構造、技術構成、決定事項） |
| `docs/02_function-design.md` | 機能ごとの入力・処理・出力、API一覧、画面遷移 |
| `docs/03_ui-design.md` | 画面デザインの方針、配色、各画面のレイアウト |
| `docs/04_tasks.md` | 開発工程のタスク一覧と進捗（作業が終わったらチェックを付ける） |

仕様に書かれていないことを決める必要があるときは、勝手に決めずに確認すること。

## 技術構成

- Next.js（App Router）＋ TypeScript
- Supabase（PostgreSQL / Auth / Storage）。権限は行単位セキュリティ（RLS）で制御する
- Vercel で公開
- マップ描画：SVG ＋ react-zoom-pan-pinch
- 区画の境界検出：OpenCV.js（ブラウザ内で実行）
- 区画番号の読み取り・翻訳：Gemini API（呼び出しは1か所にまとめ、他のAIに切り替えられるようにする）
- 多言語化：next-intl（日本語・英語・中国語簡体字・中国語繁体字）
- Excel読み込み：SheetJS ／ QRコード：qrcode ／ スマホ対応：PWA

## 開発のルール

- コードはTypeScriptで書く。`any` は使わない
- APIキーや秘密情報はコードに直接書かず、`.env.local` に置く。`.env.local` はGitに含めない
  - ブラウザに出してよい値だけ `NEXT_PUBLIC_` を付ける。Gemini APIキーやSupabaseのservice roleキーには付けない
- AIのAPIはサーバー側（Route Handler / Server Action）からだけ呼ぶ
- 管理者は自分のマップだけ編集できる。これはRLSで必ず守る（画面側のチェックだけに頼らない）
- 閲覧画面は「公開版」（map_publications）だけを読む。下書きのテーブルを閲覧者に見せない
- 区画番号の書式（例：A-101、A-1001、A-B101、N-101）のチェックは1つの関数にまとめる
- 画面の文言は最初から多言語化しやすい形（next-intlのメッセージ）で書く
- UIは `docs/03_ui-design.md` の配色と方針に合わせる。タップできる部分は44px以上
- 大きな変更の前には計画を示してから進める
- 1つのタスクが終わるごとに、動作を確認してから `docs/04_tasks.md` にチェックを付ける

## よく使うコマンド

```
npm run dev     # 開発サーバー（http://localhost:3000）
npm run build   # ビルド
npm run lint    # Lint
```

- Next.js 16（App Router、`src/` 構成、import は `@/*`）、React 19、Tailwind CSS v4、Node.js v26
- 配色は `src/app/globals.css` の `@theme` に定義済み（例：`bg-surface`、`text-text-sub`、`border-line`、`bg-primary`）。色は直接書かずにこれを使う
- 環境変数の一覧は `.env.example`。コピーして `.env.local` を作る
- `AGENTS.md` は `next dev` が自動で作成・更新する（Next.js の注意書き）。消さずにコミットしてよい

## 補足

- 工程 1-1 でNext.jsのプロジェクトを作る際、このフォルダーには既に `CLAUDE.md` と `docs/` があるため、`create-next-app` がフォルダーが空でないと止まる場合がある。その場合は一時フォルダーに作成してから中身をこのフォルダーへ移し、既存のファイルは上書きしないこと
- ソース管理はGit（Sourcetreeで操作）。コミットは利用者が行うので、勝手にコミット・プッシュしない
