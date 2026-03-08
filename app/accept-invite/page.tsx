"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function AcceptInvitePage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, displayName, password })
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Не удалось принять приглашение.");
      }
      router.push("/");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось принять приглашение.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Принять приглашение</h1>
        <p className="subtle-text">Вставьте токен приглашения и задайте пароль.</p>
        <form className="field-stack" onSubmit={onSubmit}>
          <label className="field-label">Токен приглашения</label>
          <input
            className="text-input"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
          <label className="field-label">Имя</label>
          <input
            className="text-input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <label className="field-label">Пароль</label>
          <input
            className="text-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Принимаем..." : "Принять приглашение"}
          </button>
        </form>
        {status ? <p className="status-line error">{status}</p> : null}
        <div className="auth-links">
          <Link href="/login">Назад ко входу</Link>
        </div>
      </section>
    </main>
  );
}
