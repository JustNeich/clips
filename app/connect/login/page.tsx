"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function ConnectorLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/connect/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Не удалось войти.");
      }
      router.push("/connect");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось войти.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Подключение канала</h1>
        <p className="subtle-text">
          Введите данные аккаунта, которые вам передал администратор.
        </p>
        <form className="field-stack" onSubmit={submit}>
          <label className="field-label" htmlFor="connector-email">Почта</label>
          <input
            id="connector-email"
            className="text-input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label className="field-label" htmlFor="connector-password">Пароль</label>
          <input
            id="connector-password"
            className="text-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Входим..." : "Войти"}
          </button>
        </form>
        {status ? <p className="status-line error">{status}</p> : null}
      </section>
    </main>
  );
}
