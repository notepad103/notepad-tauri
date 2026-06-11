import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AiSettings {
  model: string;
  available_models: string[];
  api_key_configured: boolean;
  key_source: string;
}

interface SettingsPageProps {
  onClose: () => void;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export default function SettingsPage({ onClose }: SettingsPageProps) {
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [dbPath, setDbPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadSettings = async () => {
    setLoading(true);
    setError("");
    try {
      const [settings, path] = await Promise.all([
        invoke<AiSettings>("get_ai_settings"),
        invoke<string>("get_db_path"),
      ]);
      setAiSettings(settings);
      setSelectedModel(settings.model);
      setDbPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    if (!copyStatus && !message) return;
    const timer = window.setTimeout(() => {
      setCopyStatus("");
      setMessage("");
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [copyStatus, message]);

  const handleSaveApiKey = async () => {
    if (!apiKey.trim() || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const settings = await invoke<AiSettings>("save_deepseek_api_key", {
        apiKey,
      });
      setAiSettings(settings);
      setApiKey("");
      setMessage("已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveModel = async () => {
    if (!selectedModel || modelSaving) return;
    setModelSaving(true);
    setError("");
    setMessage("");
    try {
      const settings = await invoke<AiSettings>("save_deepseek_model", {
        model: selectedModel,
      });
      setAiSettings(settings);
      setSelectedModel(settings.model);
      setMessage("模型已更新");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setModelSaving(false);
    }
  };

  const handleCopyDbPath = async () => {
    if (!dbPath) return;
    try {
      await copyText(dbPath);
      setCopyStatus("已复制");
    } catch (err) {
      console.error(err);
      setCopyStatus("复制失败");
    }
  };

  return (
    <main className="settings-page">
      <header className="settings-header">
        <div>
          <h2>设置</h2>
          <p>AI 服务和本地数据</p>
        </div>
        <button type="button" className="toolbar-btn" onClick={onClose}>
          返回笔记
        </button>
      </header>

      {loading ? (
        <p className="settings-muted">正在读取设置...</p>
      ) : (
        <div className="settings-content">
          <section className="settings-section">
            <div className="settings-section-meta">
              <h3>AI 服务</h3>
              <p>选择模型并配置 DeepSeek Key，所有 AI 功能会使用这里的设置。</p>
              <span
                className={`settings-status ${
                  aiSettings?.api_key_configured
                    ? "settings-status-ok"
                    : "settings-status-warn"
                }`}
              >
                {aiSettings?.api_key_configured ? "已配置" : "未配置"}
              </span>
            </div>
            <div className="settings-section-panel">
              <div className="settings-summary-row">
                <span>当前模型</span>
                <strong>{aiSettings?.model ?? "-"}</strong>
              </div>
              <div className="settings-summary-row">
                <span>Key 来源</span>
                <strong>{aiSettings?.key_source ?? "未配置"}</strong>
              </div>
              <div className="settings-field">
                <label htmlFor="deepseek-model">模型</label>
                <div className="settings-input-row">
                  <select
                    id="deepseek-model"
                    className="settings-input settings-select"
                    value={selectedModel}
                    onChange={(event) => setSelectedModel(event.target.value)}
                  >
                    {(aiSettings?.available_models ?? []).map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="toolbar-btn"
                    disabled={
                      !selectedModel ||
                      selectedModel === aiSettings?.model ||
                      modelSaving
                    }
                    onClick={() => {
                      void handleSaveModel();
                    }}
                  >
                    {modelSaving ? "保存中..." : "保存模型"}
                  </button>
                </div>
              </div>
              <div className="settings-field">
                <label htmlFor="deepseek-api-key">DeepSeek API Key</label>
                <div className="settings-input-row">
                  <input
                    id="deepseek-api-key"
                    type="password"
                    className="settings-input"
                    value={apiKey}
                    placeholder="sk-..."
                    autoComplete="off"
                    onChange={(event) => setApiKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleSaveApiKey();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="toolbar-btn toolbar-btn-primary"
                    disabled={!apiKey.trim() || saving}
                    onClick={() => {
                      void handleSaveApiKey();
                    }}
                  >
                    {saving ? "保存中..." : "保存"}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-meta">
              <h3>本地数据</h3>
              <p>笔记、分类和名词解释都会保存在本机 SQLite 数据库里。</p>
            </div>
            <div className="settings-section-panel">
              <div className="settings-path-row">
                <span className="settings-path" title={dbPath}>
                  {dbPath || "未读取到路径"}
                </span>
                <button
                  type="button"
                  className="toolbar-btn"
                  disabled={!dbPath}
                  onClick={() => {
                    void handleCopyDbPath();
                  }}
                >
                  复制路径
                </button>
              </div>
            </div>
          </section>

          {(message || copyStatus || error) && (
            <p className={error ? "settings-error" : "settings-message"}>
              {error || message || copyStatus}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
