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
        setStatus("Unable to load bootstrap status.");
        return;
      }
      setBootstrapStatus(body);
      if (body.ownerExists) {
        setStatus("Owner already exists. Use login.");
      }
    })().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load bootstrap status.");
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
        throw new Error(body?.error ?? "Unable to bootstrap owner.");
      }
      router.push("/");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to bootstrap owner.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Bootstrap owner</h1>
        <p className="subtle-text">
          One-time setup for the initial workspace owner.
          {bootstrapStatus?.secretRequired || bootstrapStatus?.secretConfigured
            ? " Requires `APP_BOOTSTRAP_SECRET`."
            : " In local/dev mode bootstrap secret is optional when it is not configured."}
        </p>
        <form className="field-stack" onSubmit={onSubmit}>
          <label className="field-label">Workspace name</label>
          <input
            className="text-input"
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            required
          />
          <label className="field-label">Display name</label>
          <input
            className="text-input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <label className="field-label">Email</label>
          <input
            className="text-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label className="field-label">Password</label>
          <input
            className="text-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {bootstrapStatus?.secretRequired || bootstrapStatus?.secretConfigured ? (
            <>
              <label className="field-label">Bootstrap secret</label>
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
            {busy ? "Bootstrapping..." : "Create owner"}
          </button>
        </form>
        {status ? <p className="status-line error">{status}</p> : null}
        <div className="auth-links">
          <Link href="/login">Back to login</Link>
        </div>
      </section>
    </main>
  );
}
