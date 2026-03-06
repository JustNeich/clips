"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppRole, AuthMeResponse, UserRecord, WorkspaceMemberRecord } from "../components/types";

type MemberRow = {
  id: string;
  role: AppRole;
  user: UserRecord;
};

export default function TeamPage() {
  const [auth, setAuth] = useState<AuthMeResponse | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("redactor_limited");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    const authResponse = await fetch("/api/auth/me");
    const authBody = (await authResponse.json()) as AuthMeResponse;
    setAuth(authBody);
    if (!authBody.effectivePermissions.canManageMembers) {
      setStatus("Forbidden.");
      return;
    }
    const membersResponse = await fetch("/api/workspace/members");
    const membersBody = (await membersResponse.json()) as { members: MemberRow[]; error?: string };
    if (!membersResponse.ok) {
      throw new Error(membersBody.error ?? "Unable to load members.");
    }
    setMembers(membersBody.members ?? []);
  };

  useEffect(() => {
    void load().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load team.");
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
        throw new Error(body?.error ?? "Unable to update role.");
      }
      await load();
      setStatus("Role updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update role.");
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
        throw new Error(body?.error ?? "Unable to create invite.");
      }
      setInviteToken(body?.invite?.token ?? null);
      setStatus("Invite created.");
      setInviteEmail("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to create invite.");
    } finally {
      setBusy(false);
    }
  };

  if (auth && !auth.effectivePermissions.canManageMembers) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Team</h1>
          <p className="status-line error">Forbidden.</p>
          <Link href="/">Back to app</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card" style={{ width: "min(880px, 100%)" }}>
        <div className="control-actions">
          <h1>Team</h1>
          <Link href="/" className="btn btn-ghost">
            Back
          </Link>
        </div>
        <p className="subtle-text">
          Manage roles and create invites. Invite token is returned directly because email delivery is
          not implemented in v1.
        </p>
        <section className="details-section">
          <h3>Members</h3>
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
                    disabled={busy || member.role === "owner"}
                    onChange={(event) => {
                      void updateRole(member.id, event.target.value as AppRole);
                    }}
                  >
                    <option value="owner">owner</option>
                    <option value="manager">manager</option>
                    <option value="redactor">redactor</option>
                    <option value="redactor_limited">redactor_limited</option>
                  </select>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="details-section">
          <h3>Create invite</h3>
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
              {auth?.membership.role === "owner" ? <option value="manager">manager</option> : null}
              <option value="redactor">redactor</option>
              <option value="redactor_limited">redactor_limited</option>
            </select>
            <button type="button" className="btn btn-primary" onClick={() => void createInvite()}>
              Create invite
            </button>
          </div>
          {inviteToken ? (
            <p className="subtle-text">
              Invite token: <strong>{inviteToken}</strong>
            </p>
          ) : null}
        </section>
        {status ? <p className="status-line ok">{status}</p> : null}
      </section>
    </main>
  );
}
