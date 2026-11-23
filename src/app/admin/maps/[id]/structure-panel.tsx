"use client";

// マップ編集画面の左列：建物とフロアの一覧と、追加・変更・並べ替え・削除（F-03）
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { suggestFloorName } from "@/lib/section-number";
import {
  addBuilding,
  addFloor,
  deleteBuilding,
  deleteFloor,
  moveBuilding,
  moveFloor,
  updateBuilding,
  updateFloor,
  type StructureErrorKey,
  type StructureResult,
} from "./structure-actions";

export type FloorItem = { id: string; code: string; name: string; sectionCount: number };
export type BuildingItem = { id: string; code: string; name: string; floors: FloorItem[] };

type Editing =
  | { kind: "building"; id: string; code: string; name: string }
  | { kind: "floor"; id: string; code: string; name: string }
  | { kind: "newBuilding" }
  | { kind: "newFloor"; buildingId: string }
  | null;

export function StructurePanel({
  mapId,
  buildings,
  selectedFloorId,
}: {
  mapId: string;
  buildings: BuildingItem[];
  selectedFloorId: string | null;
}) {
  const t = useTranslations("mapEditor");
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [error, setError] = useState<StructureErrorKey | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<StructureResult>, onSuccess?: (result: StructureResult) => void) {
    setOpenMenu(null);
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setEditing(null);
        onSuccess?.(result);
      } else {
        setError(result.error);
      }
    });
  }

  function startEditing(next: Editing) {
    setOpenMenu(null);
    setError(null);
    setEditing(next);
  }

  return (
    <nav aria-label={t("structureTitle")} className="space-y-4">
      <h2 className="text-sm font-bold text-text-sub">{t("structureTitle")}</h2>

      {error && editing === null && (
        <p role="alert" className="rounded-xl border border-error-line bg-error-bg p-3 text-sm text-error-text">
          {t(`errors.${error}`)}
        </p>
      )}

      <ul className="space-y-4">
        {buildings.map((building, bIndex) => (
          <li key={building.id} className="space-y-1">
            {editing?.kind === "building" && editing.id === building.id ? (
              <CodeNameForm
                kind="building"
                initialCode={building.code}
                initialName={building.name}
                pending={pending}
                error={error}
                onCancel={() => startEditing(null)}
                onSubmit={(code, name) => run(() => updateBuilding(building.id, code, name))}
              />
            ) : (
              <div className="flex items-center gap-1">
                <div className="flex min-w-0 flex-1 items-center gap-2 py-2">
                  <span className="rounded-md bg-text px-1.5 py-0.5 font-mono text-xs font-bold text-white">
                    {building.code}
                  </span>
                  <span className="truncate font-bold">{building.name}</span>
                </div>
                <RowMenu
                  label={t("menu", { name: building.name })}
                  open={openMenu === building.id}
                  onToggle={() => setOpenMenu(openMenu === building.id ? null : building.id)}
                  onClose={() => setOpenMenu(null)}
                  items={[
                    { label: t("edit"), onSelect: () => startEditing({ kind: "building", ...building }) },
                    { label: t("moveUp"), disabled: bIndex === 0, onSelect: () => run(() => moveBuilding(building.id, "up")) },
                    {
                      label: t("moveDown"),
                      disabled: bIndex === buildings.length - 1,
                      onSelect: () => run(() => moveBuilding(building.id, "down")),
                    },
                    {
                      label: t("delete"),
                      danger: true,
                      // 建物は最低1件必要（サーバー側でも確認している）
                      disabled: buildings.length <= 1,
                      onSelect: () => {
                        setOpenMenu(null);
                        const message = t("confirmDeleteBuilding", { name: building.name, floors: building.floors.length });
                        if (window.confirm(message)) run(() => deleteBuilding(building.id));
                      },
                    },
                  ]}
                />
              </div>
            )}

            <ul className="space-y-1 border-l-2 border-line pl-2">
              {building.floors.length === 0 && <li className="px-3 py-2 text-sm text-text-sub">{t("noFloors")}</li>}
              {building.floors.map((floor, fIndex) => {
                const selected = floor.id === selectedFloorId;
                if (editing?.kind === "floor" && editing.id === floor.id) {
                  return (
                    <li key={floor.id}>
                      <CodeNameForm
                        kind="floor"
                        initialCode={floor.code}
                        initialName={floor.name}
                        pending={pending}
                        error={error}
                        onCancel={() => startEditing(null)}
                        onSubmit={(code, name) => run(() => updateFloor(floor.id, code, name))}
                      />
                    </li>
                  );
                }
                return (
                  <li key={floor.id} className="flex items-center gap-1">
                    <Link
                      href={`/admin/maps/${mapId}?floor=${floor.id}`}
                      aria-current={selected ? "page" : undefined}
                      className={`flex h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-3 text-sm ${
                        selected ? "bg-selected-bg font-bold text-primary-text" : "hover:bg-bg"
                      }`}
                    >
                      <span className="truncate">{floor.name}</span>
                      <span className="shrink-0 text-xs text-text-sub">{t("sectionCount", { count: floor.sectionCount })}</span>
                    </Link>
                    <RowMenu
                      label={t("menu", { name: floor.name })}
                      open={openMenu === floor.id}
                      onToggle={() => setOpenMenu(openMenu === floor.id ? null : floor.id)}
                      onClose={() => setOpenMenu(null)}
                      items={[
                        { label: t("edit"), onSelect: () => startEditing({ kind: "floor", ...floor }) },
                        { label: t("moveUp"), disabled: fIndex === 0, onSelect: () => run(() => moveFloor(floor.id, "up")) },
                        {
                          label: t("moveDown"),
                          disabled: fIndex === building.floors.length - 1,
                          onSelect: () => run(() => moveFloor(floor.id, "down")),
                        },
                        {
                          label: t("delete"),
                          danger: true,
                          onSelect: () => {
                            setOpenMenu(null);
                            // 区画があるフロアだけ確認する（F-03）
                            if (
                              floor.sectionCount === 0 ||
                              window.confirm(t("confirmDeleteFloor", { name: floor.name, sections: floor.sectionCount }))
                            ) {
                              run(() => deleteFloor(floor.id));
                            }
                          },
                        },
                      ]}
                    />
                  </li>
                );
              })}
              <li>
                {editing?.kind === "newFloor" && editing.buildingId === building.id ? (
                  <CodeNameForm
                    kind="floor"
                    initialCode=""
                    initialName=""
                    pending={pending}
                    error={error}
                    onCancel={() => startEditing(null)}
                    onSubmit={(code, name) =>
                      run(
                        () => addFloor(building.id, code, name),
                        (result) => {
                          if (result.ok && result.id) router.push(`/admin/maps/${mapId}?floor=${result.id}`);
                        },
                      )
                    }
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => startEditing({ kind: "newFloor", buildingId: building.id })}
                    className="h-11 w-full rounded-xl px-3 text-left text-sm font-medium text-primary-text hover:bg-selected-bg"
                  >
                    ＋ {t("addFloor")}
                  </button>
                )}
              </li>
            </ul>
          </li>
        ))}
      </ul>

      {editing?.kind === "newBuilding" ? (
        <CodeNameForm
          kind="building"
          initialCode=""
          initialName=""
          pending={pending}
          error={error}
          onCancel={() => startEditing(null)}
          onSubmit={(code, name) => run(() => addBuilding(mapId, code, name))}
        />
      ) : (
        <button
          type="button"
          onClick={() => startEditing({ kind: "newBuilding" })}
          className="h-11 w-full rounded-xl border border-dashed border-input-line text-sm font-medium text-primary-text hover:bg-selected-bg"
        >
          ＋ {t("addBuilding")}
        </button>
      )}
    </nav>
  );
}

// ---- 行の「⋯」メニュー ------------------------------------------------------

type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean };

function RowMenu({
  label,
  open,
  onToggle,
  onClose,
  items,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  items: MenuItem[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-11 w-11 items-center justify-center rounded-xl text-lg text-text-sub hover:bg-bg"
      >
        ⋯
      </button>
      {open && (
        <ul role="menu" className="absolute right-0 z-10 mt-1 w-48 rounded-xl border border-line bg-surface py-1 shadow-lg">
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={item.onSelect}
                className={`flex h-11 w-full items-center px-4 text-left text-sm hover:bg-bg disabled:text-text-sub disabled:opacity-50 ${
                  item.danger ? "text-error-text" : ""
                }`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- コードと表示名の入力フォーム（追加・変更で共通） ----------------------

function CodeNameForm({
  kind,
  initialCode,
  initialName,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  kind: "building" | "floor";
  initialCode: string;
  initialName: string;
  pending: boolean;
  error: StructureErrorKey | null;
  onCancel: () => void;
  onSubmit: (code: string, name: string) => void;
}) {
  const t = useTranslations("mapEditor");
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(initialName);
  // 階の表示名は、利用者が手で変えるまで階コードから自動で埋める
  const [nameTouched, setNameTouched] = useState(initialName !== "");

  const inputClass =
    "h-11 w-full rounded-xl border border-input-line bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(code, name);
      }}
      className="space-y-3 rounded-xl border border-primary bg-surface p-3"
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium">{kind === "building" ? t("buildingCode") : t("floorCode")}</span>
        <input
          value={code}
          autoFocus
          required
          maxLength={3}
          onChange={(event) => {
            setCode(event.target.value);
            if (kind === "floor" && !nameTouched) setName(suggestFloorName(event.target.value.trim().toUpperCase()));
          }}
          className={`${inputClass} font-mono uppercase`}
        />
        <span className="block text-xs text-text-sub">{kind === "building" ? t("buildingCodeHint") : t("floorCodeHint")}</span>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium">{kind === "building" ? t("buildingName") : t("floorName")}</span>
        <input
          value={name}
          required
          maxLength={50}
          placeholder={kind === "building" ? t("buildingNamePlaceholder") : t("floorNamePlaceholder")}
          onChange={(event) => {
            setName(event.target.value);
            setNameTouched(true);
          }}
          className={inputClass}
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-error-text">
          {t(`errors.${error}`)}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="h-11 flex-1 rounded-xl bg-primary text-sm font-bold text-white hover:bg-primary-text disabled:opacity-60"
        >
          {pending ? t("saving") : t("save")}
        </button>
        <button type="button" onClick={onCancel} className="h-11 flex-1 rounded-xl border border-line text-sm hover:bg-bg">
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
