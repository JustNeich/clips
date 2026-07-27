"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppRole, AuthMeResponse, UserRecord } from "../components/types";

type MemberRow = {
  id: string;
  role: AppRole;
  user: UserRecord;
};

type ConnectorCredentials = {
  email: string;
  password: string;
  portalUrl: string;
};

const ROLE_LABELS: Record<AppRole, string> = {
  owner: "владелец",
  manager: "менеджер",
  redactor: "редактор",
  redactor_limited: "редактор (ограниченный)",
  channel_connector: "подключение каналов"
};

export default function TeamPage() {
  const [auth, setAuth] = useState<AuthMeResponse | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("redactor");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [connectorEmail, setConnectorEmail] = useState("");
  const [connectorName, setConnectorName] = useState("");
  const [connectorCredentials, setConnectorCredentials] = useState<ConnectorCredentials | null>(null);
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

  const removeMember = async (member: MemberRow): Promise<void> => {
    const confirmed = window.confirm(
      `Удалить ${member.user.email} из команды? Его активные сессии будут закрыты, а доступы к каналам отозваны.`
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/workspace/members/${member.id}`, {
        method: "DELETE"
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "Не удалось удалить участника.");
      }
      await load();
      setStatus("Участник удалён.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось удалить участника.");
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

  const createConnectorAccount = async (): Promise<void> => {
    setBusy(true);
    setStatus("");
    setConnectorCredentials(null);
    try {
      const response = await fetch("/api/workspace/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: connectorEmail,
          displayName: connectorName
        })
      });
      const body = (await response.json().catch(() => null)) as
        | {
            error?: string;
            credentials?: { email: string; password: string; portalUrl: string };
          }
        | null;
      if (!response.ok || !body?.credentials) {
        throw new Error(body?.error ?? "Не удалось создать аккаунт подключения.");
      }
      setConnectorCredentials(body.credentials);
      setConnectorEmail("");
      setConnectorName("");
      await load();
      setStatus("Аккаунт подключения создан. Передайте данные участнику безопасным способом.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось создать аккаунт подключения.");
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
      return memberRole === "channel_connector"
        ? ["channel_connector"]
        : ["manager", "redactor", "redactor_limited"];
    }
    if (auth.membership.role === "manager") {
      return memberRole === "redactor" || memberRole === "redactor_limited"
        ? ["redactor", "redactor_limited"]
        : [memberRole];
    }
    return [memberRole];
  };

  const canRemoveMember = (memberRole: AppRole): boolean => {
    if (!auth || memberRole === "owner") {
      return false;
    }
    if (auth.membership.role === "owner") {
      return true;
    }
    return (
      auth.membership.role === "manager" &&
      (memberRole === "redactor" ||
        memberRole === "redactor_limited" ||
        memberRole === "channel_connector")
    );
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
                  {canRemoveMember(member.role) ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => void removeMember(member)}
                    >
                      Удалить
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="details-section">
          <h3>Создать аккаунт подключения канала</h3>
          <p className="subtle-text">
            Участнику не понадобится регистрация или invite. Система создаст отдельный аккаунт и
            покажет пароль один раз. В портале участник самостоятельно создаёт новые каналы и не
            видит существующие каналы workspace.
          </p>
          <div className="field-stack">
            <input
              className="text-input"
              type="text"
              placeholder="Имя участника"
              value={connectorName}
              onChange={(event) => setConnectorName(event.target.value)}
            />
            <input
              className="text-input"
              type="email"
              placeholder="user@example.com"
              value={connectorEmail}
              onChange={(event) => setConnectorEmail(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !connectorEmail.trim()}
              onClick={() => void createConnectorAccount()}
            >
              Создать аккаунт
            </button>
          </div>
          {connectorCredentials ? (
            <div className="details-section">
              <p><strong>Данные для участника</strong></p>
              <p className="subtle-text">Страница: {connectorCredentials.portalUrl}</p>
              <p className="subtle-text">Логин: {connectorCredentials.email}</p>
              <p className="subtle-text">Пароль: <strong>{connectorCredentials.password}</strong></p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  const text = [
                    "Здравствуйте! Вам выдан доступ для подключения YouTube-каналов к публикации.",
                    "",
                    `Страница входа: ${connectorCredentials.portalUrl}`,
                    `Логин: ${connectorCredentials.email}`,
                    `Пароль: ${connectorCredentials.password}`,
                    "",
                    "После входа нажмите «Создать канал», затем «Подключить Google» и войдите в Google-аккаунт нужного YouTube-канала. Если Google покажет несколько каналов, выберите нужный. Название, username и аватарка загрузятся автоматически.",
                    "",
                    "Когда канал получит статус «Подключён», нажмите «Создать канал» и повторите действия для следующего. В портале видны только каналы, созданные вами. Регистрация не нужна.",
                    "",
                    "Если ошибочно создали пустой канал, его можно удалить до подключения. Когда подключите все каналы, напишите мне «Готово»."
                  ].join("\n");
                  void navigator.clipboard.writeText(text);
                  setStatus("Инструкция скопирована.");
                }}
              >
                Скопировать инструкцию
              </button>
            </div>
          ) : null}
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
