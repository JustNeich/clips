"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, email, password })
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Не удалось зарегистрироваться.");
      }
      router.push("/");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось зарегистрироваться.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Регистрация</h1>
        <p className="subtle-text">Публичная регистрация создаёт активный аккаунт редактора.</p>
        <form className="field-stack" onSubmit={onSubmit}>
          <label className="field-label">Имя</label>
          <input
            className="text-input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
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
            {busy ? "Создаём..." : "Создать аккаунт"}
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
