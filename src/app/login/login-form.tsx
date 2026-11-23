"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { resendConfirmation, signIn, signUp, type AuthFormState } from "./actions";

type Mode = "signIn" | "signUp";

const initialState: AuthFormState = { status: "idle" };

const inputClass =
  "h-12 w-full rounded-xl border border-input-line bg-surface px-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";
const primaryButtonClass =
  "h-12 w-full rounded-xl bg-primary font-bold text-white hover:bg-primary-text disabled:opacity-60";

export function LoginForm() {
  // 「ログイン画面に戻る」で入力状態をすべて初期化するため、key を変えて作り直す
  const [resetKey, setResetKey] = useState(0);
  return <LoginFormBody key={resetKey} onBack={() => setResetKey((k) => k + 1)} />;
}

function LoginFormBody({ onBack }: { onBack: () => void }) {
  const t = useTranslations("login");
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("signIn");
  const [signInState, signInAction, signInPending] = useActionState(signIn, initialState);
  const [signUpState, signUpAction, signUpPending] = useActionState(signUp, initialState);
  const [resendState, resendAction, resendPending] = useActionState(resendConfirmation, initialState);

  const formState = mode === "signIn" ? signInState : signUpState;
  // 再送の結果があればそちらを優先して表示する
  const state = resendState.status !== "idle" ? resendState : formState;
  const pending = mode === "signIn" ? signInPending : signUpPending;

  if (state.status === "confirmationSent" || state.status === "unconfirmed") {
    const sent = state.status === "confirmationSent";
    return (
      <div className="space-y-4">
        <div className={`rounded-xl border p-4 ${sent ? "border-success-line bg-success-bg" : "border-warning-line bg-warning-bg-light"}`}>
          <h2 className={`font-bold ${sent ? "text-success-text" : "text-warning-text"}`}>
            {sent ? t("sentTitle") : t("unconfirmedTitle")}
          </h2>
          <p className="mt-2 text-sm">
            {sent ? t("sentBody", { email: state.email }) : t("unconfirmedBody", { email: state.email })}
          </p>
          <p className="mt-2 text-sm text-text-sub">{t("sentNote")}</p>
        </div>
        {state.status === "unconfirmed" && state.resent && (
          <p role="status" className="text-sm text-success-text">{t("resent")}</p>
        )}
        <form action={resendAction}>
          <input type="hidden" name="email" value={state.email} />
          <button
            type="submit"
            disabled={resendPending}
            className="h-12 w-full rounded-xl border border-primary bg-surface font-bold text-primary-text hover:bg-selected-bg disabled:opacity-60"
          >
            {resendPending ? t("submitting") : t("resend")}
          </button>
        </form>
        <button
          type="button"
          onClick={onBack}
          className="h-11 w-full text-sm text-primary-text underline"
        >
          {t("backToSignIn")}
        </button>
      </div>
    );
  }

  const errorMessage =
    state.status === "error"
      ? t(`errors.${state.error}`)
      : searchParams.get("confirm") === "failed"
        ? t("confirmFailed")
        : null;

  return (
    <div className="space-y-5">
      <div role="tablist" className="grid grid-cols-2 rounded-xl bg-bg p-1">
        {(["signIn", "signUp"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`h-11 rounded-lg text-sm font-bold ${mode === m ? "bg-surface text-primary-text shadow-sm" : "text-text-sub"}`}
          >
            {m === "signIn" ? t("tabSignIn") : t("tabSignUp")}
          </button>
        ))}
      </div>

      {errorMessage && (
        <p role="alert" className="rounded-xl border border-error-line bg-error-bg p-3 text-sm text-error-text">
          {errorMessage}
        </p>
      )}

      <form key={mode} action={mode === "signIn" ? signInAction : signUpAction} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("email")}</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            defaultValue={state.status === "error" ? state.email : ""}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("password")}</span>
          <input
            type="password"
            name="password"
            required
            minLength={mode === "signUp" ? 6 : undefined}
            autoComplete={mode === "signIn" ? "current-password" : "new-password"}
            className={inputClass}
          />
          {mode === "signUp" && <span className="text-xs text-text-sub">{t("passwordHint")}</span>}
        </label>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? t("submitting") : mode === "signIn" ? t("submitSignIn") : t("submitSignUp")}
        </button>
      </form>
    </div>
  );
}
