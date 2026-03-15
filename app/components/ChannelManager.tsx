"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Channel,
  ChannelAccessGrant,
  ChannelAsset,
  ChannelAssetKind,
  WorkspaceMemberRecord,
  UserRecord
} from "./types";
import { STAGE3_TEMPLATE_ID } from "../../lib/stage3-template";
import { listStage3DesignLabPresets } from "../../lib/stage3-design-lab";

type ChannelManagerProps = {
  open: boolean;
  channels: Channel[];
  activeChannelId: string | null;
  assets: ChannelAsset[];
  onClose: () => void;
  onSelectChannel: (channelId: string) => void;
  onCreateChannel: () => void;
  onDeleteChannel: (channelId: string) => void;
  canCreateChannel: boolean;
  onSaveChannel: (
    channelId: string,
    patch: Partial<{
      name: string;
      username: string;
      systemPrompt: string;
      descriptionPrompt: string;
      examplesJson: string;
      templateId: string;
      avatarAssetId: string | null;
      defaultBackgroundAssetId: string | null;
      defaultMusicAssetId: string | null;
    }>
  ) => void;
  onUploadAsset: (kind: ChannelAssetKind, file: File) => void;
  onDeleteAsset: (assetId: string) => void;
  canManageAccess: boolean;
  accessGrants: ChannelAccessGrant[];
  workspaceMembers: Array<{ user: UserRecord; role: WorkspaceMemberRecord["role"] }>;
  onUpdateAccess: (channelId: string, input: { grantUserIds: string[]; revokeUserIds: string[] }) => void;
};

type TabId = "brand" | "stage2" | "render" | "assets" | "access";

function listByKind(assets: ChannelAsset[], kind: ChannelAssetKind): ChannelAsset[] {
  return assets.filter((item) => item.kind === kind);
}

export function ChannelManager({
  open,
  channels,
  activeChannelId,
  assets,
  onClose,
  onSelectChannel,
  onCreateChannel,
  onDeleteChannel,
  canCreateChannel,
  onSaveChannel,
  onUploadAsset,
  onDeleteAsset,
  canManageAccess,
  accessGrants,
  workspaceMembers,
  onUpdateAccess
}: ChannelManagerProps) {
  const [tab, setTab] = useState<TabId>("brand");
  const [mounted, setMounted] = useState(false);
  const activeChannel = useMemo(
    () => channels.find((item) => item.id === activeChannelId) ?? null,
    [channels, activeChannelId]
  );

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [descriptionPrompt, setDescriptionPrompt] = useState("");
  const [examplesJson, setExamplesJson] = useState("[]");
  const [templateId, setTemplateId] = useState(STAGE3_TEMPLATE_ID);
  const renderTemplateOptions = useMemo(
    () =>
      listStage3DesignLabPresets().map((preset) => ({
        value: preset.templateId,
        label: preset.label
      })),
    []
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!activeChannel) {
      return;
    }
    setName(activeChannel.name);
    setUsername(activeChannel.username);
    setSystemPrompt(activeChannel.systemPrompt);
    setDescriptionPrompt(activeChannel.descriptionPrompt);
    setExamplesJson(activeChannel.examplesJson);
    setTemplateId(activeChannel.templateId);
  }, [activeChannel]);

  useEffect(() => {
    if (!open || !mounted) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, mounted, onClose]);

  if (!open || !mounted) {
    return null;
  }

  const avatars = listByKind(assets, "avatar");
  const backgrounds = listByKind(assets, "background");
  const music = listByKind(assets, "music");
  const activeGrantUserIds = new Set(accessGrants.map((grant) => grant.userId));
  const accessCandidates = workspaceMembers.filter((member) => member.role !== "owner");

  const formatTabLabel = (value: "brand" | "stage2" | "render" | "assets" | "access") => {
    switch (value) {
      case "brand":
        return "Бренд";
      case "stage2":
        return "Stage 2";
      case "render":
        return "Рендер";
      case "assets":
        return "Ассеты";
      case "access":
        return "Доступ";
      default:
        return value;
    }
  };

  return createPortal(
    <div
      className="channel-manager-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Управление каналами"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="channel-manager">
        <header className="channel-manager-head">
          <h2>Управление каналами</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <section className="channel-manager-toolbar">
          <select
            className="text-input"
            value={activeChannelId ?? ""}
            onChange={(event) => {
              const channelId = event.target.value;
              if (!channelId) {
                return;
              }
              onSelectChannel(channelId);
            }}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name} @{channel.username}
              </option>
            ))}
          </select>
          {canCreateChannel ? (
            <button type="button" className="btn btn-secondary" onClick={onCreateChannel}>
              + Новый канал
            </button>
          ) : null}
          {activeChannel ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onDeleteChannel(activeChannel.id)}
              disabled={channels.length <= 1 || !activeChannel.currentUserCanEditSetup}
            >
              Удалить канал
            </button>
          ) : null}
        </section>

        <div className="channel-tabs">
          {(["brand", "stage2", "render", "assets", "access"] as const).map((item) => {
            if (item === "access" && !canManageAccess) {
              return null;
            }
            return (
            <button
              key={item}
              type="button"
              className={`channel-tab ${tab === item ? "active" : ""}`}
              onClick={() => setTab(item)}
            >
              {formatTabLabel(item)}
            </button>
            );
          })}
        </div>

        {!activeChannel ? (
          <p className="subtle-text">Выберите канал.</p>
        ) : (
          <div className="channel-tab-content">
            {tab === "brand" ? (
              <div className="field-stack">
                <label className="field-label">Название канала</label>
                <input className="text-input" value={name} onChange={(event) => setName(event.target.value)} />
                <label className="field-label">Username канала</label>
                <input
                  className="text-input"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="science_snack"
                />
                <div className="control-actions">
                  <label className="btn btn-ghost background-upload-btn">
                    <input
                      type="file"
                      accept="image/*"
                      className="background-upload-input"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          return;
                        }
                        onUploadAsset("avatar", file);
                        event.currentTarget.value = "";
                      }}
                    />
                    Загрузить аватар
                  </label>
                  <select
                    className="text-input"
                    value={activeChannel.avatarAssetId ?? ""}
                    onChange={(event) =>
                        onSaveChannel(activeChannel.id, { avatarAssetId: event.target.value || null })
                    }
                  >
                    <option value="">Без аватара</option>
                    {avatars.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.originalName}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!activeChannel.currentUserCanEditSetup}
                  onClick={() =>
                    onSaveChannel(activeChannel.id, {
                      name,
                      username
                    })
                  }
                >
                  Сохранить бренд
                </button>
              </div>
            ) : null}

            {tab === "stage2" ? (
              <div className="field-stack">
                <label className="field-label">Системный промпт</label>
                <textarea
                  className="text-area"
                  rows={9}
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                />
                <label className="field-label">Промпт описания (авто SEO)</label>
                <textarea
                  className="text-area"
                  rows={9}
                  value={descriptionPrompt}
                  onChange={(event) => setDescriptionPrompt(event.target.value)}
                />
                <label className="field-label">examples.json</label>
                <textarea
                  className="text-area mono"
                  rows={9}
                  value={examplesJson}
                  onChange={(event) => setExamplesJson(event.target.value)}
                />
                <div className="control-actions">
                  <label className="btn btn-ghost background-upload-btn">
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="background-upload-input"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          return;
                        }
                        void file
                          .text()
                          .then((content) => {
                            setExamplesJson(content);
                          })
                          .catch(() => undefined);
                        event.currentTarget.value = "";
                      }}
                    />
                    Upload examples.json
                  </label>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!activeChannel.currentUserCanEditSetup}
                  onClick={() =>
                    onSaveChannel(activeChannel.id, {
                      systemPrompt,
                      descriptionPrompt,
                      examplesJson
                    })
                  }
                >
                  Сохранить конфиг Stage 2
                </button>
              </div>
            ) : null}

            {tab === "render" ? (
              <div className="field-stack">
                <label className="field-label">Шаблон</label>
                <select
                  className="text-input"
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  {renderTemplateOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="compact-grid">
                  <div className="compact-field">
                    <label className="field-label">Фон по умолчанию</label>
                    <select
                      className="text-input"
                      value={activeChannel.defaultBackgroundAssetId ?? ""}
                      onChange={(event) =>
                        onSaveChannel(activeChannel.id, {
                          defaultBackgroundAssetId: event.target.value || null
                        })
                      }
                    >
                      <option value="">None</option>
                      {backgrounds.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.originalName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="compact-field">
                    <label className="field-label">Музыка по умолчанию</label>
                    <select
                      className="text-input"
                      value={activeChannel.defaultMusicAssetId ?? ""}
                      onChange={(event) =>
                        onSaveChannel(activeChannel.id, {
                          defaultMusicAssetId: event.target.value || null
                        })
                      }
                    >
                      <option value="">None</option>
                      {music.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.originalName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!activeChannel.currentUserCanEditSetup}
                  onClick={() => onSaveChannel(activeChannel.id, { templateId })}
                >
                  Сохранить настройки рендера
                </button>
              </div>
            ) : null}

            {tab === "assets" ? (
              <div className="field-stack">
                <div className="control-actions">
                  <label className="btn btn-ghost background-upload-btn">
                    <input
                      type="file"
                      accept="image/*,video/*"
                      className="background-upload-input"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          return;
                        }
                        onUploadAsset("background", file);
                        event.currentTarget.value = "";
                      }}
                    />
                    Загрузить фон
                  </label>
                  <label className="btn btn-ghost background-upload-btn">
                    <input
                      type="file"
                      accept="audio/*"
                      className="background-upload-input"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          return;
                        }
                        onUploadAsset("music", file);
                        event.currentTarget.value = "";
                      }}
                    />
                    Загрузить музыку
                  </label>
                </div>
                <section className="details-section">
                  <h3>Фоны ({backgrounds.length})</h3>
                  <ul className="details-log-list">
                    {backgrounds.map((asset) => (
                      <li key={asset.id} className="log-item">
                        <p>{asset.originalName}</p>
                        <div className="control-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() =>
                            onSaveChannel(activeChannel.id, { defaultBackgroundAssetId: asset.id })
                          }
                        >
                            Сделать по умолчанию
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => onDeleteAsset(asset.id)}>
                            Удалить
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="details-section">
                  <h3>Музыка ({music.length})</h3>
                  <ul className="details-log-list">
                    {music.map((asset) => (
                      <li key={asset.id} className="log-item">
                        <p>{asset.originalName}</p>
                        <div className="control-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => onSaveChannel(activeChannel.id, { defaultMusicAssetId: asset.id })}
                          >
                            Сделать по умолчанию
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => onDeleteAsset(asset.id)}>
                            Удалить
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="details-section">
                  <h3>Аватары ({avatars.length})</h3>
                  <ul className="details-log-list">
                    {avatars.map((asset) => (
                      <li key={asset.id} className="log-item">
                        <p>{asset.originalName}</p>
                        <div className="control-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => onSaveChannel(activeChannel.id, { avatarAssetId: asset.id })}
                          >
                            Сделать аватаром
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => onDeleteAsset(asset.id)}>
                            Удалить
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            ) : null}

            {tab === "access" && canManageAccess ? (
              <div className="field-stack">
                <p className="subtle-text">
                  Менеджеры и владелец могут выдавать рабочий доступ к каналам.
                </p>
                <section className="details-section">
                  <h3>Текущий доступ ({accessGrants.length})</h3>
                  <ul className="details-log-list">
                    {accessGrants.length === 0 ? (
                      <li className="log-item">
                        <p>Явных выдач доступа нет.</p>
                      </li>
                    ) : (
                      accessGrants.map((grant) => (
                        <li key={grant.id} className="log-item">
                          <p>
                            {grant.user?.displayName ?? grant.userId}{" "}
                            <span className="subtle-text">{grant.user?.email ?? ""}</span>
                          </p>
                          <div className="control-actions">
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() =>
                                onUpdateAccess(activeChannel.id, {
                                  grantUserIds: [],
                                  revokeUserIds: [grant.userId]
                                })
                              }
                            >
                              Отозвать
                            </button>
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                </section>
                <section className="details-section">
                  <h3>Выдать доступ</h3>
                  <ul className="details-log-list">
                    {accessCandidates.map((member) => (
                      <li key={member.user.id} className="log-item">
                        <p>
                          {member.user.displayName}{" "}
                          <span className="subtle-text">
                            {member.user.email} · {member.role}
                          </span>
                        </p>
                        <div className="control-actions">
                          {activeGrantUserIds.has(member.user.id) ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() =>
                                onUpdateAccess(activeChannel.id, {
                                  grantUserIds: [],
                                  revokeUserIds: [member.user.id]
                                })
                              }
                            >
                              Отозвать
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() =>
                                onUpdateAccess(activeChannel.id, {
                                  grantUserIds: [member.user.id],
                                  revokeUserIds: []
                                })
                              }
                            >
                              Выдать рабочий доступ
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
