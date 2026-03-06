import { AppRole, type ChannelAccessRecord, type WorkspaceMemberRecord } from "./team-store";
import { Channel } from "./chat-history";

export type ChannelPermissions = {
  isVisible: boolean;
  canOperate: boolean;
  canEditSetup: boolean;
  canManageAccess: boolean;
  canDelete: boolean;
};

export function isManagerLike(role: AppRole): boolean {
  return role === "owner" || role === "manager";
}

export function resolveChannelPermissions(input: {
  membership: WorkspaceMemberRecord;
  channel: Pick<Channel, "id" | "creatorUserId">;
  explicitAccess: ChannelAccessRecord | null;
}): ChannelPermissions {
  const { membership, channel, explicitAccess } = input;
  const role = membership.role;
  const isCreator = membership.userId === channel.creatorUserId;
  const hasExplicitOperate = explicitAccess?.revokedAt ? false : explicitAccess?.accessRole === "operate";

  if (role === "owner" || role === "manager") {
    return {
      isVisible: true,
      canOperate: true,
      canEditSetup: true,
      canManageAccess: true,
      canDelete: true
    };
  }

  if (role === "redactor") {
    const visible = isCreator || hasExplicitOperate;
    return {
      isVisible: visible,
      canOperate: visible,
      canEditSetup: isCreator,
      canManageAccess: false,
      canDelete: isCreator
    };
  }

  return {
    isVisible: hasExplicitOperate,
    canOperate: hasExplicitOperate,
    canEditSetup: false,
    canManageAccess: false,
    canDelete: false
  };
}
