"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type BootstrapStatus = {
  ownerExists: boolean;
  secretConfigured: boolean;
  secretRequired: boolean;
  allowWithoutSecret: boolean;
};

export default function BootstrapOwnerPage() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/auth/bootstrap-owner");
      const body = (await response.json().catch(() => null)) as BootstrapStatus | null;
      if (!response.ok || !body) {
        setStatus("Не удалось загрузить статус инициализации.");
        return;
      }
      setBootstrapStatus(body);
      if (body.ownerExists) {
        setStatus("Владелец уже существует. Используйте страницу входа.");
      }
    })().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить статус инициализации.");
    });
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/auth/bootstrap-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceName,
          displayName,
          email,
          password,
          bootstrapSecret
        })
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Не удалось создать владельца.");
      }
      router.push("/");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось создать владельца.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Создание владельца</h1>
        <p className="subtle-text">
          Одноразовая настройка первого владельца рабочего пространства.
          {bootstrapStatus?.secretRequired || bootstrapStatus?.secretConfigured
            ? " Требуется `APP_BOOTSTRAP_SECRET`."
            : " В локальном/dev режиме секрет не обязателен, если он не настроен."}
        </p>
        <form className="field-stack" onSubmit={onSubmit}>
          <label className="field-label">Название рабочего пространства</label>
          <input
            className="text-input"
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            required
          />
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
          {bootstrapStatus?.secretRequired || bootstrapStatus?.secretConfigured ? (
            <>
              <label className="field-label">Секрет инициализации</label>
              <input
                className="text-input"
                type="password"
                value={bootstrapSecret}
                onChange={(event) => setBootstrapSecret(event.target.value)}
                required
              />
            </>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Создаём..." : "Создать владельца"}
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
