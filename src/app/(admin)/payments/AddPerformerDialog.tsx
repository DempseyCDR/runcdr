"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import Dialog from "@/app/_components/Dialog";
import PerformerPicker, { type PickedPerformer } from "./PerformerPicker";
import { ROLE_LABEL, send } from "./savePayment";
import styles from "./payments.module.css";

type Role = { performerType: string; rate: number };

/**
 * Feature 081 (FR-023, MARY-R3): add a performer who played but was not booked. Mary finds them (or creates
 * them), picks a role the series allows, and sees that role's rate, which she may change; the rate used becomes
 * the new booking's booked amount.
 */
export default function AddPerformerDialog({
  eventId,
  onClose,
  onSaved,
}: {
  eventId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [picked, setPicked] = useState<PickedPerformer | null>(null);
  const [role, setRole] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch(`/api/events/${eventId}/roles`)
      .then((r) => r.json())
      .then((d) => {
        const list: Role[] = d.roles ?? [];
        setRoles(list);
        if (list[0]) {
          setRole(list[0].performerType);
          setAmount(list[0].rate.toFixed(2));
        }
      });
  }, [eventId]);

  const rate = roles.find((r) => r.performerType === role)?.rate ?? 0;

  function chooseRole(type: string) {
    setRole(type);
    setAmount((roles.find((r) => r.performerType === type)?.rate ?? 0).toFixed(2));
  }

  async function add() {
    if (!picked) return;
    setError(null);
    const pay = Number(amount);
    if (amount.trim() === "" || !(pay >= 0)) return setError("Enter the amount agreed.");
    const sent = await send(`/api/events/${eventId}/settlement-performer`, "POST", {
      performerId: picked.id,
      performerType: role,
      ...(pay !== rate ? { pay } : {}),
    });
    if (!sent.ok) return setError(sent.message);
    onClose();
    onSaved();
  }

  return (
    <Dialog label="Add a performer" onClose={onClose}>
      {picked ? (
        <div className={styles.entry}>
          <div className={`${styles.rowHead} ${styles.wide}`}>
            <p className={styles.name}>{picked.displayName}</p>
            <button type="button" className={styles.button} onClick={() => setPicked(null)}>
              Change
            </button>
          </div>
          <label>
            Role
            <select
              className={styles.input}
              value={role}
              onChange={(e) => chooseRole(e.target.value)}
            >
              {roles.map((r) => (
                <option key={r.performerType} value={r.performerType}>
                  {ROLE_LABEL[r.performerType] ?? r.performerType}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input
              className={styles.input}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <div className={`${styles.buttons} ${styles.wide}`}>
            <button type="button" className={styles.primaryButton} onClick={() => void add()}>
              Add
            </button>
            <button type="button" className={styles.button} onClick={onClose}>
              Cancel
            </button>
          </div>
          {error && (
            <p role="alert" className={`${styles.error} ${styles.wide}`}>
              {error}
            </p>
          )}
        </div>
      ) : (
        <>
          <PerformerPicker eventId={eventId} onPicked={setPicked} />
          <div className={styles.buttons}>
            <button type="button" className={styles.button} onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
