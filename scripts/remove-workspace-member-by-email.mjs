#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function parseArgs(argv) {
  const args = {
    email: "",
    appDataDir: process.env.APP_DATA_DIR?.trim() || "",
    yes: false
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--email") {
      args.email = argv[index + 1]?.trim() || "";
      index += 1;
    } else if (arg === "--app-data-dir") {
      args.appDataDir = argv[index + 1]?.trim() || "";
      index += 1;
    } else if (arg === "--yes") {
      args.yes = true;
    }
  }
  return args;
}

function resolveAppDataDir(explicit) {
  if (explicit) {
    return explicit;
  }
  if (process.env.RENDER) {
    return "/var/data/app";
  }
  return path.join(process.cwd(), ".data");
}

function backupDbFiles(appDataDir) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const backupDir = path.join(appDataDir, "maintenance-backups", `remove-workspace-member-${stamp}`);
  mkdirSync(backupDir, { recursive: true });
  for (const fileName of ["app.db", "app.db-wal", "app.db-shm"]) {
    const source = path.join(appDataDir, fileName);
    if (existsSync(source)) {
      copyFileSync(source, path.join(backupDir, fileName));
    }
  }
  return backupDir;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.email) {
    throw new Error("Pass --email user@example.com.");
  }
  const appDataDir = resolveAppDataDir(args.appDataDir);
  const dbPath = path.join(appDataDir, "app.db");
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}.`);
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  const user = db
    .prepare("SELECT id, email, display_name, status FROM users WHERE lower(email) = lower(?) LIMIT 1")
    .get(args.email);
  if (!user) {
    console.log(JSON.stringify({ ok: true, action: "noop", reason: "user_not_found", email: args.email }));
    return;
  }

  const memberships = db
    .prepare("SELECT id, workspace_id, user_id, role FROM workspace_members WHERE user_id = ?")
    .all(user.id);
  const workspaceIds = memberships.map((membership) => membership.workspace_id);
  const placeholders = workspaceIds.map(() => "?").join(",");
  const activeSessions = workspaceIds.length
    ? db
        .prepare(`SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = ? AND workspace_id IN (${placeholders})`)
        .get(user.id, ...workspaceIds).count
    : 0;
  const activeChannelAccess = workspaceIds.length
    ? db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM channel_access
           WHERE user_id = ?
             AND revoked_at IS NULL
             AND channel_id IN (SELECT id FROM channels WHERE workspace_id IN (${placeholders}))`
        )
        .get(user.id, ...workspaceIds).count
    : 0;

  const summary = {
    email: user.email,
    memberships: memberships.map((membership) => ({
      id: membership.id,
      workspaceId: membership.workspace_id,
      role: membership.role
    })),
    activeSessions,
    activeChannelAccess
  };

  if (!args.yes) {
    console.log(JSON.stringify({ ok: true, action: "dry_run", ...summary }, null, 2));
    return;
  }

  const backupDir = backupDbFiles(appDataDir);
  const revokedAt = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (workspaceIds.length) {
      db.prepare(`DELETE FROM auth_sessions WHERE user_id = ? AND workspace_id IN (${placeholders})`).run(
        user.id,
        ...workspaceIds
      );
      db.prepare(
        `UPDATE channel_access
         SET revoked_at = ?
         WHERE user_id = ?
           AND revoked_at IS NULL
           AND channel_id IN (SELECT id FROM channels WHERE workspace_id IN (${placeholders}))`
      ).run(revokedAt, user.id, ...workspaceIds);
    }
    db.prepare("DELETE FROM workspace_members WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM workspace_invites WHERE lower(email) = lower(?) AND accepted_at IS NULL").run(
      user.email
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  console.log(JSON.stringify({ ok: true, action: "removed_membership", backupDir, ...summary }, null, 2));
}

main();
