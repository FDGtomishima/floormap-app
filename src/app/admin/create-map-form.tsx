"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { createMap, type CreateMapState } from "./actions";

const initialState: CreateMapState = { error: null, name: "" };

export function CreateMapForm({ disabled }: { disabled: boolean }) {
  const t = useTranslations("admin");
  const [state, action, pending] = useActionState(createMap, initialState);

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-line bg-surface p-5">
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("mapName")}</span>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            name="name"
            required
            maxLength={100}
            disabled={disabled}
            defaultValue={state.name}
            placeholder={t("mapNamePlaceholder")}
            className="h-11 flex-1 rounded-xl border border-input-line bg-surface px-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:bg-bg"
          />
          <button
            type="submit"
            disabled={disabled || pending}
            className="h-11 rounded-xl bg-primary px-5 font-bold text-white hover:bg-primary-text disabled:opacity-50"
          >
            {pending ? t("creating") : t("createMap")}
          </button>
        </div>
      </label>
      {state.error && (
        <p role="alert" className="rounded-xl border border-error-line bg-error-bg p-3 text-sm text-error-text">
          {t(`createErrors.${state.error}`)}
        </p>
      )}
    </form>
  );
}
