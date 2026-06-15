use crate::webpage::page_text;
use futures_util::StreamExt;
use reqwest::Url;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf, time::Duration};
use tauri::ipc::Channel;

const DEEPSEEK_API_URL: &str = "https://api.deepseek.com/chat/completions";
const DEFAULT_DEEPSEEK_MODEL: &str = "deepseek-v4-pro";
const DEEPSEEK_MODELS: &[&str] = &["deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"];
const ARTICLE_TEXT_LIMIT: usize = 20_000;
const AI_TIMEOUT_SECS: u64 = 45;
const DEEPSEEK_API_KEY_ENV: &str = "DEEPSEEK_API_KEY";
const DEEPSEEK_MODEL_ENV: &str = "DEEPSEEK_MODEL";

#[derive(Serialize)]
pub struct WebpageSummary {
    title: String,
    content: String,
}

#[derive(Serialize)]
pub struct AiNoteDraft {
    pub title: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct AiSettings {
    model: String,
    available_models: Vec<&'static str>,
    api_key_configured: bool,
    key_source: String,
}

#[derive(Deserialize)]
struct AiTermsJson {
    terms: Vec<AiTerm>,
}

#[derive(Serialize, Deserialize)]
pub struct AiTerm {
    term: String,
    explanation: String,
    context: String,
}

#[derive(Serialize, Deserialize)]
pub struct KnowledgeGraph {
    nodes: Vec<KnowledgeNode>,
    edges: Vec<KnowledgeEdge>,
}

#[derive(Serialize, Deserialize)]
pub struct KnowledgeNode {
    id: String,
    label: String,
    node_type: String,
}

#[derive(Serialize, Deserialize)]
pub struct KnowledgeEdge {
    source: String,
    target: String,
    label: String,
    description: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum StreamEvent {
    Delta(String),
    Done,
    Error(String),
}

#[derive(Clone, Serialize)]
pub struct AiMessage {
    role: &'static str,
    content: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<AiMessage>,
    temperature: f32,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<ThinkingConfig>,
}

#[derive(Serialize)]
struct ThinkingConfig {
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatResponseMessage,
}

#[derive(Deserialize)]
struct ChatResponseMessage {
    content: String,
}

#[derive(Deserialize)]
struct ChatStreamChunk {
    choices: Vec<ChatStreamChoice>,
}

#[derive(Deserialize)]
struct ChatStreamChoice {
    delta: ChatStreamDelta,
}

#[derive(Deserialize)]
struct ChatStreamDelta {
    content: Option<String>,
}

#[derive(Deserialize)]
struct SummaryJson {
    title: String,
    summary: String,
}

pub(crate) struct AiClient {
    http: reqwest::Client,
    api_key: String,
}

struct RewooEvidence<'a> {
    label: &'a str,
    content: &'a str,
}

struct RewooPrompt<'a> {
    objective: &'a str,
    plan: &'a [&'a str],
    evidence: &'a [RewooEvidence<'a>],
    output_contract: &'a str,
}

impl AiMessage {
    pub(crate) fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system",
            content: content.into(),
        }
    }

    pub(crate) fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user",
            content: content.into(),
        }
    }
}

impl AiClient {
    pub(crate) fn new() -> Result<Self, String> {
        Ok(Self {
            http: build_http_client("notepad-tauri/0.1 ai client")?,
            api_key: deepseek_api_key()?,
        })
    }

    pub(crate) async fn chat_text(
        &self,
        messages: Vec<AiMessage>,
        temperature: f32,
    ) -> Result<String, String> {
        self.chat_text_with_options(deepseek_model(), messages, temperature, None)
            .await
    }

    pub(crate) async fn chat_text_with_model_without_reasoning(
        &self,
        model: impl Into<String>,
        messages: Vec<AiMessage>,
        temperature: f32,
    ) -> Result<String, String> {
        self.chat_text_with_options(
            model.into(),
            messages,
            temperature,
            Some(ThinkingConfig { kind: "disabled" }),
        )
        .await
    }

    async fn chat_text_with_options(
        &self,
        model: String,
        messages: Vec<AiMessage>,
        temperature: f32,
        thinking: Option<ThinkingConfig>,
    ) -> Result<String, String> {
        let request = ChatRequest {
            model,
            messages,
            temperature,
            stream: false,
            thinking,
        };

        let response = self
            .http
            .post(DEEPSEEK_API_URL)
            .bearer_auth(&self.api_key)
            .json(&request)
            .send()
            .await
            .map_err(|err| format!("DeepSeek 请求失败：{}", err))?
            .error_for_status()
            .map_err(|err| format!("DeepSeek 返回错误：{}", err))?
            .json::<ChatResponse>()
            .await
            .map_err(|err| format!("DeepSeek 响应解析失败：{}", err))?;

        response
            .choices
            .first()
            .map(|choice| choice.message.content.trim().to_string())
            .filter(|content| !content.is_empty())
            .ok_or_else(|| "DeepSeek 没有返回内容".to_string())
    }

    pub(crate) async fn chat_text_stream(
        &self,
        messages: Vec<AiMessage>,
        temperature: f32,
        channel: Channel<StreamEvent>,
    ) -> Result<(), String> {
        let request = ChatRequest {
            model: deepseek_model(),
            messages,
            temperature,
            stream: true,
            thinking: None,
        };

        let response = self
            .http
            .post(DEEPSEEK_API_URL)
            .bearer_auth(&self.api_key)
            .json(&request)
            .send()
            .await
            .map_err(|err| format!("DeepSeek 请求失败：{}", err))?
            .error_for_status()
            .map_err(|err| format!("DeepSeek 返回错误：{}", err))?;

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|err| format!("DeepSeek 流读取失败：{}", err))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim().to_string();
                buffer = buffer[line_end + 1..].to_string();

                if line.is_empty() || !line.starts_with("data:") {
                    continue;
                }

                let data = line.trim_start_matches("data:").trim();
                if data == "[DONE]" {
                    channel
                        .send(StreamEvent::Done)
                        .map_err(|err| err.to_string())?;
                    return Ok(());
                }

                if let Ok(chunk) = serde_json::from_str::<ChatStreamChunk>(data) {
                    for choice in chunk.choices {
                        if let Some(delta) = choice.delta.content {
                            if !delta.is_empty() {
                                channel
                                    .send(StreamEvent::Delta(delta))
                                    .map_err(|err| err.to_string())?;
                            }
                        }
                    }
                }
            }
        }

        channel
            .send(StreamEvent::Done)
            .map_err(|err| err.to_string())?;
        Ok(())
    }
}

fn build_http_client(user_agent: &str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(AI_TIMEOUT_SECS))
        .user_agent(user_agent)
        .build()
        .map_err(|err| err.to_string())
}

fn env_local_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from(".env.local")];
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join(".env.local"));
    if let Some(parent) = manifest_dir.parent() {
        candidates.push(parent.join(".env.local"));
    }

    candidates
}

fn read_env_local_value(key: &str) -> Option<String> {
    env_local_candidates()
        .into_iter()
        .find_map(|path| fs::read_to_string(path).ok())
        .and_then(|content| {
            content.lines().find_map(|line| {
                let line = line.trim();
                if line.starts_with('#') || line.is_empty() {
                    return None;
                }
                line.strip_prefix(&format!("{}=", key))
                    .map(|value| value.trim_matches('"').trim_matches('\'').to_string())
            })
        })
        .filter(|value| !value.is_empty())
}

fn read_env_local_key() -> Option<String> {
    read_env_local_value(DEEPSEEK_API_KEY_ENV)
}

fn env_local_key_source() -> Option<String> {
    env_local_candidates().into_iter().find_map(|path| {
        let content = fs::read_to_string(&path).ok()?;
        content.lines().find_map(|line| {
            let line = line.trim();
            if line.starts_with('#') || line.is_empty() {
                return None;
            }
            line.strip_prefix(&format!("{}=", DEEPSEEK_API_KEY_ENV))
                .map(|value| value.trim_matches('"').trim_matches('\'').to_string())
                .filter(|key| !key.is_empty())
                .map(|_| path.to_string_lossy().into_owned())
        })
    })
}

fn deepseek_api_key() -> Result<String, String> {
    env::var(DEEPSEEK_API_KEY_ENV)
        .ok()
        .filter(|key| !key.trim().is_empty())
        .or_else(read_env_local_key)
        .ok_or_else(|| {
            "未找到 DeepSeek Key，请设置 DEEPSEEK_API_KEY 或项目根目录 .env.local".to_string()
        })
}

fn deepseek_model() -> String {
    env::var(DEEPSEEK_MODEL_ENV)
        .ok()
        .filter(|model| !model.trim().is_empty())
        .or_else(|| read_env_local_value(DEEPSEEK_MODEL_ENV))
        .unwrap_or_else(|| DEFAULT_DEEPSEEK_MODEL.to_string())
}

fn ai_settings() -> AiSettings {
    let env_key_configured = env::var(DEEPSEEK_API_KEY_ENV)
        .ok()
        .is_some_and(|key| !key.trim().is_empty());
    let env_local_source = env_local_key_source();

    AiSettings {
        model: deepseek_model(),
        available_models: DEEPSEEK_MODELS.to_vec(),
        api_key_configured: env_key_configured || env_local_source.is_some(),
        key_source: if env_key_configured {
            "环境变量".to_string()
        } else if env_local_source.is_some() {
            ".env.local".to_string()
        } else {
            "未配置".to_string()
        },
    }
}

fn write_env_local_value(key: &str, value: &str) -> Result<(), String> {
    let path = PathBuf::from(".env.local");
    let current = fs::read_to_string(&path).unwrap_or_default();
    let next_line = format!("{}={}", key, value.trim());
    let mut replaced = false;
    let mut lines = current
        .lines()
        .map(|line| {
            if line.trim_start().starts_with(&format!("{}=", key)) {
                replaced = true;
                next_line.clone()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>();

    if !replaced {
        lines.push(next_line);
    }

    fs::write(&path, format!("{}\n", lines.join("\n"))).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_ai_settings() -> Result<AiSettings, String> {
    Ok(ai_settings())
}

#[tauri::command]
pub fn save_deepseek_api_key(api_key: String) -> Result<AiSettings, String> {
    let clean_key = api_key.trim();
    if clean_key.is_empty() {
        return Err("请输入 DeepSeek API Key".to_string());
    }

    write_env_local_value(DEEPSEEK_API_KEY_ENV, clean_key)?;
    env::set_var(DEEPSEEK_API_KEY_ENV, clean_key);

    Ok(ai_settings())
}

#[tauri::command]
pub fn save_deepseek_model(model: String) -> Result<AiSettings, String> {
    let clean_model = model.trim();
    if clean_model.is_empty() {
        return Err("请选择模型".to_string());
    }

    write_env_local_value(DEEPSEEK_MODEL_ENV, clean_model)?;
    env::set_var(DEEPSEEK_MODEL_ENV, clean_model);

    Ok(ai_settings())
}

fn normalize_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn build_rewoo_prompt(task: RewooPrompt<'_>) -> String {
    let plan = task
        .plan
        .iter()
        .enumerate()
        .map(|(index, step)| format!("{}. {}", index + 1, step))
        .collect::<Vec<_>>()
        .join("\n");
    let evidence = task
        .evidence
        .iter()
        .map(|item| format!("## {}\n{}", item.label, item.content.trim()))
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        "请按 ReWOO（Reasoning without Observation）工作流处理任务：先依据 Plan 在 Evidence 中定位信息，再整合为最终结果。不要输出推理过程、计划执行过程或中间观察，只输出 Output Contract 要求的最终结果。\n\n# Objective\n{}\n\n# Plan\n{}\n\n# Evidence\n{}\n\n# Output Contract\n{}",
        task.objective.trim(),
        plan,
        evidence,
        task.output_contract.trim()
    )
}

fn strip_json_fence(content: &str) -> &str {
    let trimmed = content.trim();
    if let Some(text) = trimmed.strip_prefix("```json") {
        return text.strip_suffix("```").unwrap_or(text).trim();
    }
    if let Some(text) = trimmed.strip_prefix("```") {
        return text.strip_suffix("```").unwrap_or(text).trim();
    }
    trimmed
}

fn extract_json_object(content: &str) -> Option<&str> {
    let mut start = None;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in content.char_indices() {
        if start.is_none() {
            if ch == '{' {
                start = Some(index);
                depth = 1;
            }
            continue;
        }

        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let end = index + ch.len_utf8();
                    return start.map(|start| &content[start..end]);
                }
            }
            _ => {}
        }
    }

    None
}

fn parse_ai_json<T: DeserializeOwned>(content: &str) -> Option<T> {
    let fenced = strip_json_fence(content);
    serde_json::from_str::<T>(fenced)
        .ok()
        .or_else(|| extract_json_object(fenced).and_then(|json| serde_json::from_str(json).ok()))
        .or_else(|| extract_json_object(content).and_then(|json| serde_json::from_str(json).ok()))
}

pub(crate) fn parse_ai_note(content: &str, raw_markdown_title: &str) -> AiNoteDraft {
    let trimmed = content.trim();

    if let Some(parsed) = parse_ai_json::<SummaryJson>(trimmed) {
        return AiNoteDraft {
            title: parsed.title.trim().to_string(),
            content: parsed.summary.trim().to_string(),
        };
    }

    AiNoteDraft {
        title: raw_markdown_title.to_string(),
        content: trimmed.to_string(),
    }
}

fn compact_article_content(content: &str) -> String {
    normalize_whitespace(content)
        .chars()
        .take(ARTICLE_TEXT_LIMIT)
        .collect()
}

fn parse_terms(content: &str) -> Vec<AiTerm> {
    parse_ai_json::<AiTermsJson>(content)
        .map(|parsed| {
            parsed
                .terms
                .into_iter()
                .filter(|term| !term.term.trim().is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn build_term_supplement_prompt(
    title: &str,
    content: &str,
    term: &str,
    explanation: &str,
    context: &str,
) -> Result<String, String> {
    let clean_term = term.trim();
    if clean_term.is_empty() {
        return Err("请选择要解释的名词".to_string());
    }

    let source_title = title.trim();
    let article = compact_article_content(content);
    if article.chars().count() < 80 {
        return Err("当前文章内容太短，无法结合主题解释名词".to_string());
    }

    let title_evidence = if source_title.is_empty() {
        "未命名笔记"
    } else {
        source_title
    };
    let term_evidence = format!(
        "名词：{}\n已有简释：{}\n已有上下文：{}",
        clean_term,
        explanation.trim(),
        context.trim()
    );
    let output_contract = "用中文；不要覆盖、复述或改写已有简释；不要泛泛百科化；输出 Markdown，不要输出 JSON；必须只返回两个二级标题小节，标题分别是“## 结合文章的补充说明”和“## 适用场景和示例”。第一节说明它在本文中的具体含义、为什么重要、和文章主旨的关系，控制在 360 字以内。第二节必须写 2 到 3 组，每组都必须包含“场景：”和“示例：”，且“示例：”必须另起一行写在对应场景下面，禁止把场景和示例合并到同一行；示例要是具体句子、具体操作、具体案例或贴近本文的具体情境，不要只写抽象用途，第二节控制在 440 字以内。\n\n第二节必须严格使用这个换行格式：\n**场景 1：** 在读者需要判断某个概念对本文结论的影响时。\n**示例：** 如果文章在讨论成本结构，就说明这个名词如何改变成本测算。\n\n**场景 2：** 在把文章观点迁移到实际决策时。\n**示例：** 用一个具体业务选择展示这个名词如何参与判断。";

    Ok(build_rewoo_prompt(RewooPrompt {
        objective: "结合文章主题为指定名词补充说明。",
        plan: &[
            "识别指定名词在文章中的出现语境和承担的作用。",
            "用已有简释作为边界，避免重复百科定义。",
            "提炼该名词与文章主旨的关系，并补充可落地的场景和示例。",
            "按 Output Contract 输出最终 Markdown。",
        ],
        evidence: &[
            RewooEvidence {
                label: "文章标题",
                content: title_evidence,
            },
            RewooEvidence {
                label: "指定名词和已有解释",
                content: &term_evidence,
            },
            RewooEvidence {
                label: "文章内容",
                content: &article,
            },
        ],
        output_contract,
    }))
}

fn parse_knowledge_graph(content: &str) -> Option<KnowledgeGraph> {
    parse_ai_json(content)
}

#[tauri::command]
pub async fn summarize_webpage(url: String) -> Result<WebpageSummary, String> {
    let parsed_url = Url::parse(url.trim()).map_err(|_| "请输入有效的网址".to_string())?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("只支持 http 或 https 网页".to_string());
    }

    let web_client = build_http_client("notepad-tauri/0.1 webpage summarizer")?;

    let html = web_client
        .get(parsed_url.clone())
        .send()
        .await
        .map_err(|err| format!("网页读取失败：{}", err))?
        .error_for_status()
        .map_err(|err| format!("网页读取失败：{}", err))?
        .text()
        .await
        .map_err(|err| format!("网页内容读取失败：{}", err))?;

    let (source_title, readable_text) = page_text(&html, &parsed_url)?;
    let page_meta = format!("网页标题：{}\n网页地址：{}", source_title, parsed_url);
    let prompt = build_rewoo_prompt(RewooPrompt {
        objective: "把网页内容整理成一篇可直接保存的 AI 阅读笔记，而不是普通摘要。",
        plan: &[
            "从网页正文中定位核心结论、主要事实、数字、时间、人物、产品、机构和行动建议。",
            "过滤广告、推广、赞助、导航、评论、相关推荐、订阅弹窗等非正文内容。",
            "保留影响理解的专业名词、缩写、机构名、背景概念或技术术语。",
            "按 Output Contract 生成严格 JSON。",
        ],
        evidence: &[
            RewooEvidence {
                label: "网页元信息",
                content: &page_meta,
            },
            RewooEvidence {
                label: "网页正文",
                content: &readable_text,
            },
        ],
        output_contract: "用中文；保留关键结论、事实、数据和行动建议；如图片信息与正文理解有关，在 Markdown 正文中用简短说明保留，并可使用 ![说明](图片地址) 引用图片；输出严格 JSON，格式为 {\"title\":\"不超过24字的中文笔记标题\",\"summary\":\"Markdown 正文\"}。\n\nsummary 必须使用下面固定 Markdown 结构：\n## 一句话概览\n用 1 到 2 句话说明这篇网页最值得记住的内容。\n\n## 关键内容\n用 3 到 6 条列表提炼主要观点、论据或步骤。\n\n## 重要事实和数据\n用列表保留网页中的关键事实、数字、时间、人物、产品、机构或出处；如果原文没有明确事实数据，写“- 原文没有提供明确数据”。\n\n## 值得解释的名词\n列出 3 到 8 个影响理解的专业名词、缩写、机构名、背景概念或技术术语，并用一句话说明为什么值得解释；不要罗列普通词。\n\n## 行动建议或启发\n用 2 到 4 条列表写出读者可以如何使用这篇内容，建议要具体。",
    });

    let content = AiClient::new()?
        .chat_text(
            vec![
                AiMessage::system("你是一个擅长提炼网页信息的中文笔记助手。"),
                AiMessage::user(prompt),
            ],
            0.2,
        )
        .await?;

    let mut summary = parse_ai_note(&content, &format!("AI阅读：{}", source_title));
    if summary.title.is_empty() {
        summary.title = format!("AI阅读：{}", source_title);
    }
    if summary.content.is_empty() {
        return Err("DeepSeek 返回了空总结".to_string());
    }

    Ok(WebpageSummary {
        title: summary.title,
        content: summary.content,
    })
}

#[tauri::command]
pub async fn summarize_note(title: String, content: String) -> Result<WebpageSummary, String> {
    let source_title = title.trim();
    let note_content = compact_article_content(&content);
    if note_content.chars().count() < 80 {
        return Err("当前笔记内容太短，无法生成摘要笔记".to_string());
    }

    let title_evidence = if source_title.is_empty() {
        "未命名笔记"
    } else {
        source_title
    };
    let prompt = build_rewoo_prompt(RewooPrompt {
        objective: "把用户的当前笔记整理成一篇可独立保存的中文摘要笔记。",
        plan: &[
            "阅读笔记标题和正文，识别核心主题、结论、关键事实、待办、问题和可复用知识点。",
            "保留原笔记中影响理解的数字、时间、人物、产品、机构、引用和术语。",
            "过滤寒暄、重复记录、格式噪声和不影响理解的细枝末节。",
            "按 Output Contract 生成严格 JSON。",
        ],
        evidence: &[
            RewooEvidence {
                label: "原笔记标题",
                content: title_evidence,
            },
            RewooEvidence {
                label: "原笔记内容",
                content: &note_content,
            },
        ],
        output_contract: "用中文；只依据原笔记内容，不要编造原文没有的信息；输出严格 JSON，格式为 {\"title\":\"不超过24字的中文摘要标题\",\"summary\":\"Markdown 正文\"}。\n\nsummary 必须使用下面固定 Markdown 结构：\n## 一句话摘要\n用 1 到 2 句话说明这条笔记最重要的信息。\n\n## 核心要点\n用 3 到 6 条列表提炼主要观点、结论、论据或步骤。\n\n## 关键事实和细节\n用列表保留原笔记中的重要事实、数字、时间、人物、产品、机构、链接或引用；如果原笔记没有明确事实，写“- 原笔记没有提供明确事实”。\n\n## 待跟进问题\n列出 0 到 5 条仍需确认、继续阅读、执行或追踪的问题；没有则写“- 暂无”。\n\n## 可复用启发\n用 2 到 4 条列表写出这条笔记之后可如何使用，必须具体。",
    });

    let content = AiClient::new()?
        .chat_text(
            vec![
                AiMessage::system("你是一个擅长把原始记录整理成中文摘要笔记的助手。"),
                AiMessage::user(prompt),
            ],
            0.2,
        )
        .await?;

    let fallback_title = format!("摘要：{}", title_evidence);
    let mut summary = parse_ai_note(&content, &fallback_title);
    if summary.title.is_empty() {
        summary.title = fallback_title;
    }
    if summary.content.is_empty() {
        return Err("DeepSeek 返回了空摘要".to_string());
    }

    Ok(WebpageSummary {
        title: summary.title,
        content: summary.content,
    })
}

#[tauri::command]
pub async fn explain_article_terms(title: String, content: String) -> Result<Vec<AiTerm>, String> {
    let source_title = title.trim();
    let article = compact_article_content(&content);
    if article.chars().count() < 80 {
        return Err("当前文章内容太短，无法分析需要解释的名词".to_string());
    }

    let title_evidence = if source_title.is_empty() {
        "未命名笔记"
    } else {
        source_title
    };
    let prompt = build_rewoo_prompt(RewooPrompt {
        objective: "分析文章并找出读者可能需要解释的关键名词。",
        plan: &[
            "浏览文章标题和正文，识别影响理解的专业名词、缩写、概念、机构名、技术术语或背景概念。",
            "过滤普通词、泛泛概念和不影响理解的词。",
            "为每个入选名词写一句话简明定义和本文语境背景。",
            "按 Output Contract 输出严格 JSON。",
        ],
        evidence: &[
            RewooEvidence {
                label: "文章标题",
                content: title_evidence,
            },
            RewooEvidence {
                label: "文章内容",
                content: &article,
            },
        ],
        output_contract: "只选真正影响理解的名词，不要罗列普通词；最多 12 个；用中文解释；输出严格 JSON，格式为 {\"terms\":[{\"term\":\"名词\",\"explanation\":\"一句话简明定义\",\"context\":\"它在本文中的含义或必要背景\"}]}。",
    });

    let content = AiClient::new()?
        .chat_text(
            vec![
                AiMessage::system("你是一个擅长为文章补充术语解释的中文知识助手。"),
                AiMessage::user(prompt),
            ],
            0.2,
        )
        .await?;

    let terms = parse_terms(&content);
    if terms.is_empty() {
        return Err("DeepSeek 没有返回可展示的名词解释".to_string());
    }

    Ok(terms)
}

#[tauri::command]
pub async fn explain_article_term_stream(
    title: String,
    content: String,
    term: String,
    explanation: String,
    context: String,
    channel: Channel<StreamEvent>,
) -> Result<(), String> {
    let error_channel = channel.clone();
    let prompt = match build_term_supplement_prompt(&title, &content, &term, &explanation, &context)
    {
        Ok(prompt) => prompt,
        Err(err) => {
            let _ = error_channel.send(StreamEvent::Error(err.clone()));
            return Err(err);
        }
    };

    match AiClient::new()?
        .chat_text_stream(
            vec![
                AiMessage::system("你是一个擅长结合文章语境解释概念的中文知识助手。"),
                AiMessage::user(prompt),
            ],
            0.2,
            channel,
        )
        .await
    {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = error_channel.send(StreamEvent::Error(err.clone()));
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn generate_term_knowledge_graph(
    title: String,
    content: String,
    term: String,
    explanation: String,
    context: String,
) -> Result<KnowledgeGraph, String> {
    let clean_term = term.trim();
    if clean_term.is_empty() {
        return Err("请选择要生成知识图谱的名词".to_string());
    }

    let source_title = title.trim();
    let article = compact_article_content(&content);
    if article.chars().count() < 80 {
        return Err("当前文章内容太短，无法生成知识图谱".to_string());
    }

    let title_evidence = if source_title.is_empty() {
        "未命名笔记"
    } else {
        source_title
    };
    let term_evidence = format!(
        "中心名词：{}\n已有简释：{}\n已有上下文：{}",
        clean_term,
        explanation.trim(),
        context.trim()
    );
    let prompt = build_rewoo_prompt(RewooPrompt {
        objective: "围绕指定名词，结合文章主题生成局部知识图谱。",
        plan: &[
            "确认中心名词及其在文章中的语境。",
            "从文章中抽取真正相关的概念、对象、机制或背景节点。",
            "判断节点之间在本文语境下的关系，并写短关系标签和一句话说明。",
            "按 Output Contract 输出可渲染的严格 JSON。",
        ],
        evidence: &[
            RewooEvidence {
                label: "文章标题",
                content: title_evidence,
            },
            RewooEvidence {
                label: "中心名词和已有解释",
                content: &term_evidence,
            },
            RewooEvidence {
                label: "文章内容",
                content: &article,
            },
        ],
        output_contract: "中心节点必须是该名词；节点总数 5 到 9 个；只包含文章语境中真正相关的概念、对象、机制或背景；关系标签要短，例如“影响”“依赖”“属于”“导致”“对比”“应用于”；输出严格 JSON，不要 Markdown，不要解释。格式为 {\"nodes\":[{\"id\":\"稳定英文或拼音ID\",\"label\":\"节点名称\",\"node_type\":\"term|concept|entity|mechanism|background\"}],\"edges\":[{\"source\":\"节点ID\",\"target\":\"节点ID\",\"label\":\"关系\",\"description\":\"一句话说明关系\"}]}。",
    });

    let content = AiClient::new()?
        .chat_text(
            vec![
                AiMessage::system("你是一个擅长从文章语境中抽取概念关系的中文知识图谱助手。"),
                AiMessage::user(prompt),
            ],
            0.2,
        )
        .await?;

    let graph = parse_knowledge_graph(&content)
        .ok_or_else(|| "DeepSeek 没有返回可渲染的知识图谱，请重试".to_string())?;
    if graph.nodes.is_empty() {
        return Err("知识图谱没有节点，请重试".to_string());
    }

    Ok(graph)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ai_note_extracts_json_from_wrapped_reply() {
        let reply = r###"
            下面是整理好的 JSON：
            ```json
            {"title":"测试标题","summary":"## 一句话概览\n正文内容"}
            ```
        "###;

        let draft = parse_ai_note(reply, "备用标题");

        assert_eq!(draft.title, "测试标题");
        assert_eq!(draft.content, "## 一句话概览\n正文内容");
    }

    #[test]
    fn parse_terms_extracts_json_from_plain_wrapped_reply() {
        let reply = r#"
            结果如下：
            {"terms":[{"term":"Tauri","explanation":"桌面应用框架","context":"本文用于构建本地应用"}]}
        "#;

        let terms = parse_terms(reply);

        assert_eq!(terms.len(), 1);
        assert_eq!(terms[0].term, "Tauri");
    }
}
