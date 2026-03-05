"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Channel, ChannelAsset, ChannelAssetKind } from "./types";

type ChannelManagerProps = {
  open: boolean;
  channels: Channel[];
  activeChannelId: string | null;
  assets: ChannelAsset[];
  onClose: () => void;
  onSelectChannel: (channelId: string) => void;
  onCreateChannel: () => void;
  onDeleteChannel: (channelId: string) => void;
  onSaveChannel: (
    channelId: string,
    patch: Partial<{
      name: string;
      username: string;
      systemPrompt: string;
      examplesJson: string;
      templateId: string;
      avatarAssetId: string | null;
      defaultBackgroundAssetId: string | null;
      defaultMusicAssetId: string | null;
    }>
  ) => void;
  onUploadAsset: (kind: ChannelAssetKind, file: File) => void;
  onDeleteAsset: (assetId: string) => void;
};

type TabId = "brand" | "stage2" | "render" | "assets";

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
  onSaveChannel,
  onUploadAsset,
  onDeleteAsset
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
  const [examplesJson, setExamplesJson] = useState("[]");
  const [templateId, setTemplateId] = useState("science-card-v1");

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

  return createPortal(
    <div
      className="channel-manager-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Manage channels"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="channel-manager">
        <header className="channel-manager-head">
          <h2>Manage channels</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
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
          <button type="button" className="btn btn-secondary" onClick={onCreateChannel}>
            + New channel
          </button>
          {activeChannel ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onDeleteChannel(activeChannel.id)}
              disabled={channels.length <= 1}
            >
              Delete channel
            </button>
          ) : null}
        </section>

        <div className="channel-tabs">
          {(["brand", "stage2", "render", "assets"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`channel-tab ${tab === item ? "active" : ""}`}
              onClick={() => setTab(item)}
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>

        {!activeChannel ? (
          <p className="subtle-text">Select channel.</p>
        ) : (
          <div className="channel-tab-content">
            {tab === "brand" ? (
              <div className="field-stack">
                <label className="field-label">Channel name</label>
                <input className="text-input" value={name} onChange={(event) => setName(event.target.value)} />
                <label className="field-label">Channel username</label>
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
                    Upload avatar
                  </label>
                  <select
                    className="text-input"
                    value={activeChannel.avatarAssetId ?? ""}
                    onChange={(event) =>
                      onSaveChannel(activeChannel.id, { avatarAssetId: event.target.value || null })
                    }
                  >
                    <option value="">No avatar</option>
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
                  onClick={() =>
                    onSaveChannel(activeChannel.id, {
                      name,
                      username
                    })
                  }
                >
                  Save brand
                </button>
              </div>
            ) : null}

            {tab === "stage2" ? (
              <div className="field-stack">
                <label className="field-label">System prompt</label>
                <textarea
                  className="text-area"
                  rows={9}
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
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
                  onClick={() =>
                    onSaveChannel(activeChannel.id, {
                      systemPrompt,
                      examplesJson
                    })
                  }
                >
                  Save Stage2 config
                </button>
              </div>
            ) : null}

            {tab === "render" ? (
              <div className="field-stack">
                <label className="field-label">Template</label>
                <input
                  className="text-input"
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                />
                <div className="compact-grid">
                  <div className="compact-field">
                    <label className="field-label">Default background</label>
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
                    <label className="field-label">Default music</label>
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
                  onClick={() => onSaveChannel(activeChannel.id, { templateId })}
                >
                  Save render defaults
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
                    Upload background
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
                    Upload music
                  </label>
                </div>
                <section className="details-section">
                  <h3>Backgrounds ({backgrounds.length})</h3>
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
                            Set default
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => onDeleteAsset(asset.id)}>
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="details-section">
                  <h3>Music ({music.length})</h3>
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
                            Set default
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => onDeleteAsset(asset.id)}>
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="details-section">
                  <h3>Avatars ({avatars.length})</h3>
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
                            Set avatar
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => onDeleteAsset(asset.id)}>
                            Delete
                          </button>
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
