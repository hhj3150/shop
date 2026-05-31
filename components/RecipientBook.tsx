"use client";

import { useEffect, useState } from "react";
import { Field } from "@/components/Field";
import { AddressSearch } from "@/components/AddressSearch";
import {
  loadRecipients,
  addRecipient,
  updateRecipient,
  deleteRecipient,
  type Recipient,
  type RecipientInput,
} from "@/lib/recipients";

const EMPTY: RecipientInput = {
  name: "",
  phone: "",
  postcode: "",
  address: "",
  addressDetail: "",
  memo: "",
};

// 마이페이지 받는 사람 주소록. 자녀·손주 등 선물 받을 분 주소를 저장·수정·삭제.
//   여기 저장한 주소는 체크아웃(정기·단품)에서 "선물하기" 선택 시 불러온다.
export function RecipientBook({ userId }: { userId: string }) {
  const [list, setList] = useState<Recipient[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RecipientInput>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRecipients(userId)
      .then(setList)
      .catch(() => setList([]));
  }, [userId]);

  function update<K extends keyof RecipientInput>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY);
    setAdding(true);
    setError(null);
  }

  function openEdit(r: Recipient) {
    setAdding(false);
    setEditingId(r.id);
    setForm({
      name: r.name,
      phone: r.phone,
      postcode: r.postcode ?? "",
      address: r.address,
      addressDetail: r.addressDetail ?? "",
      memo: r.memo ?? "",
    });
    setError(null);
  }

  function close() {
    setAdding(false);
    setEditingId(null);
    setForm(EMPTY);
    setError(null);
  }

  async function onSave() {
    setError(null);
    setBusy(true);
    try {
      if (editingId) {
        const updated = await updateRecipient(editingId, form);
        setList((prev) => prev.map((r) => (r.id === editingId ? updated : r)));
      } else {
        const created = await addRecipient(userId, form);
        setList((prev) => [created, ...prev]);
      }
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("이 받는 분을 주소록에서 삭제하시겠어요?")) return;
    setBusy(true);
    try {
      await deleteRecipient(id);
      setList((prev) => prev.filter((r) => r.id !== id));
      if (editingId === id) close();
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const showForm = adding || editingId !== null;

  return (
    <section className="mt-12">
      <div className="flex items-end justify-between">
        <h2 className="font-serif-kr text-lg text-ink">받는 사람 주소록</h2>
        {!showForm && (
          <button
            onClick={openAdd}
            className="rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
          >
            + 받는 분 추가
          </button>
        )}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-mute">
        자녀·손주 등 선물 받을 분의 주소를 저장해 두면, 정기구독·단품 주문 시 선물
        받는 분으로 선택할 수 있습니다.
      </p>

      {list.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-cream">
          {list.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-ink">
                  {r.name}
                  {r.memo && (
                    <span className="ml-2 text-[12px] text-mute">{r.memo}</span>
                  )}
                </p>
                <p className="mt-0.5 text-[13px] tabular-nums text-mute">{r.phone}</p>
                <p className="mt-0.5 text-[13px] text-ink-soft">
                  {r.postcode ? `(${r.postcode}) ` : ""}
                  {r.address} {r.addressDetail}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => openEdit(r)}
                  className="text-[13px] text-mute underline transition-colors hover:text-ink"
                >
                  수정
                </button>
                <button
                  onClick={() => onDelete(r.id)}
                  disabled={busy}
                  className="text-[13px] text-mute underline transition-colors hover:text-red-600 disabled:opacity-50"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <div className="mt-4 space-y-4 rounded-2xl border border-line bg-paper-2 p-5">
          <p className="text-[14px] font-medium text-ink">
            {editingId ? "받는 분 정보 수정" : "받는 분 추가"}
          </p>
          <Field
            id="rcp-name"
            label="받는 분 이름"
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
          />
          <Field
            id="rcp-phone"
            label="받는 분 휴대폰 번호"
            inputMode="numeric"
            placeholder="01012345678"
            required
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
          />
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field
                id="rcp-postcode"
                label="우편번호"
                inputMode="numeric"
                value={form.postcode ?? ""}
                onChange={(e) => update("postcode", e.target.value)}
              />
            </div>
            <div className="pb-1">
              <AddressSearch
                onSelect={(postcode, address) =>
                  setForm((prev) => ({ ...prev, postcode, address }))
                }
              />
            </div>
          </div>
          <Field
            id="rcp-address"
            label="주소"
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
          />
          <Field
            id="rcp-address-detail"
            label="상세 주소"
            value={form.addressDetail ?? ""}
            onChange={(e) => update("addressDetail", e.target.value)}
          />
          <Field
            id="rcp-memo"
            label="메모 (선택)"
            placeholder="예: 큰손주, 부모님 댁"
            value={form.memo ?? ""}
            onChange={(e) => update("memo", e.target.value)}
          />

          {error && (
            <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={busy}
              className="flex-1 rounded-full bg-ink py-3 text-[14px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-50"
            >
              {busy ? "저장 중…" : "저장"}
            </button>
            <button
              onClick={close}
              disabled={busy}
              className="rounded-full border border-line px-5 py-3 text-[14px] text-ink-soft transition-colors hover:border-gold disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
