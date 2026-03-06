import { hasWorkspaceBootstrap } from "./team-store";

export type BootstrapStatus = {
  ownerExists: boolean;
  secretConfigured: boolean;
  secretRequired: boolean;
  allowWithoutSecret: boolean;
};

export function getBootstrapStatus(): BootstrapStatus {
  const secretConfigured = Boolean(process.env.APP_BOOTSTRAP_SECRET?.trim());
  const secretRequired = process.env.NODE_ENV === "production";
  return {
    ownerExists: hasWorkspaceBootstrap(),
    secretConfigured,
    secretRequired,
    allowWithoutSecret: !secretConfigured && !secretRequired
  };
}
