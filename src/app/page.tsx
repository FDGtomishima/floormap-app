// 仮のトップページ（工程1-1の動作確認用）。
// コード入力画面は後の工程で作り、文言は 6-1 で next-intl のメッセージに移す。
export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center">
        <h1 className="text-xl font-bold">フロアマップ</h1>
        <p className="mt-2 text-sm text-text-sub">準備中です</p>
      </div>
    </main>
  );
}
