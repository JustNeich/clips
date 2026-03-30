"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppRole, AuthMeResponse, UserRecord, WorkspaceMemberRecord } from "../components/types";

type MemberRow = {
  id: string;
  role: AppRole;
  user: UserRecord;
};

const ROLE_LABELS: Record<AppRole, string> = {
  owner: "владелец",
  manager: "менеджер",
  redactor: "редактор",
  redactor_limited: "редактор (ограниченный)"
};

export default function TeamPage() {
  const [auth, setAuth] = useState<AuthMeResponse | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("redactor");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    const authResponse = await fetch("/api/auth/me");
    const authBody = (await authResponse.json()) as AuthMeResponse;
    setAuth(authBody);
    if (!authBody.effectivePermissions.canManageMembers) {
      setStatus("Доступ запрещён.");
      return;
    }
    const membersResponse = await fetch("/api/workspace/members");
    const membersBody = (await membersResponse.json()) as { members: MemberRow[]; error?: string };
    if (!membersResponse.ok) {
      throw new Error(membersBody.error ?? "Не удалось загрузить участников.");
    }
    setMembers(membersBody.members ?? []);
  };

  useEffect(() => {
    void load().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить команду.");
    });
  }, []);

  const updateRole = async (memberId: string, role: AppRole): Promise<void> => {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/workspace/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role })
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Не удалось обновить роль.");
      }
      await load();
      setStatus("Роль обновлена.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось обновить роль.");
    } finally {
      setBusy(false);
    }
  };

  const createInvite = async (): Promise<void> => {
    setBusy(true);
    setStatus("");
    setInviteToken(null);
    try {
      const response = await fetch("/api/workspace/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole })
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string; invite?: { token: string } }
        | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Не удалось создать приглашение.");
      }
      setInviteToken(body?.invite?.token ?? null);
      setStatus("Приглашение создано.");
      setInviteEmail("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось создать приглашение.");
    } finally {
      setBusy(false);
    }
  };

  const inviteOptions: AppRole[] =
    auth?.membership.role === "owner"
      ? ["manager", "redactor", "redactor_limited"]
      : ["redactor", "redactor_limited"];

  const getAssignableRoles = (memberRole: AppRole): AppRole[] => {
    if (!auth) {
      return [];
    }
    if (memberRole === "owner") {
      return ["owner"];
    }
    if (auth.membership.role === "owner") {
      return ["manager", "redactor", "redactor_limited"];
    }
    if (auth.membership.role === "manager") {
      return memberRole === "redactor" || memberRole === "redactor_limited"
        ? ["redactor", "redactor_limited"]
        : [memberRole];
    }
    return [memberRole];
  };

  if (auth && !auth.effectivePermissions.canManageMembers) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Команда</h1>
          <p className="status-line error">Доступ запрещён.</p>
          <Link href="/">Назад в приложение</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card" style={{ width: "min(880px, 100%)" }}>
        <div className="control-actions">
          <h1>Команда</h1>
          <Link href="/" className="btn btn-ghost">
            Назад
          </Link>
        </div>
        <p className="subtle-text">
          Управляйте ролями и создавайте приглашения. Токен приглашения показывается сразу, потому
          что отправка писем в v1 ещё не реализована. По умолчанию приглашение создаётся для полного
          редактора, а ограниченный режим остаётся отдельной явной опцией.
        </p>
        <section className="details-section">
          <h3>Участники</h3>
          <ul className="details-log-list">
            {members.map((member) => (
              <li key={member.id} className="log-item">
                <p>
                  {member.user.displayName}{" "}
                  <span className="subtle-text">{member.user.email}</span>
                </p>
                <div className="control-actions">
                  <select
                    className="text-input"
                    value={member.role}
                    disabled={
                      busy ||
                      member.role === "owner" ||
                      getAssignableRoles(member.role).length <= 1
                    }
                    onChange={(event) => {
                      void updateRole(member.id, event.target.value as AppRole);
                    }}
                  >
                    {getAssignableRoles(member.role).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="details-section">
          <h3>Создать приглашение</h3>
          <div className="field-stack">
            <input
              className="text-input"
              type="email"
              placeholder="user@example.com"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
            <select
              className="text-input"
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as AppRole)}
            >
              {inviteOptions.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary" onClick={() => void createInvite()}>
              Создать приглашение
            </button>
          </div>
          {inviteToken ? (
            <p className="subtle-text">
              Токен приглашения: <strong>{inviteToken}</strong>
            </p>
          ) : null}
        </section>
        {status ? <p className="status-line ok">{status}</p> : null}
      </section>
    </main>
  );
}
