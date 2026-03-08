"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Не удалось войти.");
      }
      router.push("/");
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
        <h1>Вход</h1>
        <p className="subtle-text">
          Используйте служебный аккаунт. Shared Codex определяется на сервере.
        </p>
        <form className="field-stack" onSubmit={onSubmit}>
          <label className="field-label">Почта</label>
          <input
            className="text-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
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
            {busy ? "Входим..." : "Войти"}
          </button>
        </form>
        {status ? <p className="status-line error">{status}</p> : null}
        <div className="auth-links">
          <Link href="/register">Создать аккаунт редактора</Link>
          <Link href="/accept-invite">Принять приглашение</Link>
          <Link href="/setup/bootstrap-owner">Создать владельца</Link>
        </div>
      </section>
    </main>
  );
}
