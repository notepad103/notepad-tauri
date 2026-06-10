use futures_util::StreamExt;
use reqwest::Url;
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, env, fs, path::PathBuf, time::Duration};
use tauri::ipc::Channel;

const DEEPSEEK_API_URL: &str = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL: &str = "deepseek-v4-pro";
const WEBPAGE_TEXT_LIMIT: usize = 18_000;
const WEBPAGE_IMAGE_LIMIT: usize = 12;
const WEBPAGE_MIN_TEXT_LENGTH: usize = 30;
const ARTICLE_TEXT_LIMIT: usize = 20_000;
const AI_TIMEOUT_SECS: u64 = 45;
const NOISE_ATTRIBUTE_KEYWORDS: &[&str] = &[
    "ad",
    "ads",
    "advert",
    "advertisement",
    "sponsor",
    "sponsored",
    "promo",
    "promoted",
    "recommend",
    "related",
    "sidebar",
    "nav",
    "menu",
    "footer",
    "header",
    "comment",
    "comments",
    "share",
    "social",
    "subscribe",
    "newsletter",
    "cookie",
    "banner",
    "popup",
    "modal",
    "breadcrumb",
    "toolbar",
    "widget",
    "paywall",
    "广告",
    "推广",
    "赞助",
    "推荐",
    "相关阅读",
    "评论",
    "分享",
    "订阅",
    "导航",
    "菜单",
    "侧栏",
    "页脚",
    "弹窗",
    "横幅",
];
const NOISE_TEXT_KEYWORDS: &[&str] = &[
    "广告",
    "推广",
    "赞助",
    "相关阅读",
    "相关推荐",
    "推荐阅读",
    "点击查看",
    "打开app",
    "打开 app",
    "下载app",
    "下载 app",
    "扫码",
    "关注我们",
    "分享至",
    "登录后",
    "注册后",
    "更多精彩",
    "版权所有",
    "免责声明",
    "advertisement",
    "sponsored",
    "subscribe",
    "newsletter",
];

#[derive(Serialize)]
pub struct WebpageSummary {
    title: String,
    content: String,
}

#[derive(Serialize)]
pub struct AiNoteDraft {
    title: String,
    content: String,
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
    model: &'static str,
    messages: Vec<AiMessage>,
    temperature: f32,
    stream: bool,
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

#[derive(Clone)]
struct PageImage {
    src: String,
    alt: String,
    title: String,
    caption: String,
}

struct AiClient {
    http: reqwest::Client,
    api_key: String,
}

impl AiMessage {
    fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system",
            content: content.into(),
        }
    }

    fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user",
            content: content.into(),
        }
    }
}

impl AiClient {
    fn new() -> Result<Self, String> {
        Ok(Self {
            http: build_http_client("notepad-tauri/0.1 ai client")?,
            api_key: deepseek_api_key()?,
        })
    }

    async fn chat_text(
        &self,
        messages: Vec<AiMessage>,
        temperature: f32,
    ) -> Result<String, String> {
        let request = ChatRequest {
            model: DEEPSEEK_MODEL,
            messages,
            temperature,
            stream: false,
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

    async fn chat_text_stream(
        &self,
        messages: Vec<AiMessage>,
        temperature: f32,
        channel: Channel<StreamEvent>,
    ) -> Result<(), String> {
        let request = ChatRequest {
            model: DEEPSEEK_MODEL,
            messages,
            temperature,
            stream: true,
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

fn read_env_local_key() -> Option<String> {
    let mut candidates = vec![PathBuf::from(".env.local")];
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join(".env.local"));
    if let Some(parent) = manifest_dir.parent() {
        candidates.push(parent.join(".env.local"));
    }

    candidates
        .into_iter()
        .find_map(|path| fs::read_to_string(path).ok())
        .and_then(|content| {
            content.lines().find_map(|line| {
                let line = line.trim();
                if line.starts_with('#') || line.is_empty() {
                    return None;
                }
                line.strip_prefix("DEEPSEEK_API_KEY=")
                    .map(|value| value.trim_matches('"').trim_matches('\'').to_string())
            })
        })
        .filter(|key| !key.is_empty())
}

fn deepseek_api_key() -> Result<String, String> {
    env::var("DEEPSEEK_API_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty())
        .or_else(read_env_local_key)
        .ok_or_else(|| {
            "未找到 DeepSeek Key，请设置 DEEPSEEK_API_KEY 或项目根目录 .env.local".to_string()
        })
}

fn normalize_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn candidate_image_url(element: &ElementRef<'_>) -> Option<String> {
    [
        "data-src",
        "data-original",
        "data-lazy-src",
        "data-actualsrc",
        "data-image",
        "data-url",
        "src",
    ]
    .into_iter()
    .filter_map(|attr| element.attr(attr))
    .map(str::trim)
    .find(|value| !value.is_empty())
    .map(ToString::to_string)
    .or_else(|| {
        element
            .attr("srcset")
            .or_else(|| element.attr("data-srcset"))
            .and_then(largest_srcset_candidate)
    })
}

fn largest_srcset_candidate(srcset: &str) -> Option<String> {
    srcset
        .split(',')
        .filter_map(|candidate| candidate.split_whitespace().next())
        .filter(|src| !src.is_empty())
        .last()
        .map(ToString::to_string)
}

fn absolute_image_url(page_url: &Url, raw_src: &str) -> Option<String> {
    let src = raw_src.trim();
    if src.is_empty()
        || src.starts_with("data:")
        || src.starts_with("blob:")
        || src.starts_with('#')
    {
        return None;
    }

    page_url
        .join(src)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .map(|url| url.to_string())
}

fn image_caption(element: &ElementRef<'_>, caption_selector: &Selector) -> String {
    element
        .ancestors()
        .filter_map(ElementRef::wrap)
        .find(|ancestor| ancestor.value().name() == "figure")
        .and_then(|figure| figure.select(caption_selector).next())
        .map(|caption| normalize_whitespace(&caption.text().collect::<Vec<_>>().join(" ")))
        .filter(|caption| !caption.is_empty())
        .unwrap_or_default()
}

fn json_string_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str).filter(|text| {
        let text = text.trim();
        !text.is_empty()
    })
}

fn json_description(value: &Value) -> Option<String> {
    match value {
        Value::Array(items) => items.iter().find_map(json_description),
        Value::Object(_) => json_string_field(value, "description")
            .map(normalize_whitespace)
            .or_else(|| {
                value
                    .get("@graph")
                    .and_then(|graph| graph.as_array())
                    .and_then(|items| items.iter().find_map(json_description))
            }),
        _ => None,
    }
}

fn json_image_urls(value: &Value) -> Vec<String> {
    match value {
        Value::String(url) => vec![url.to_string()],
        Value::Array(items) => items.iter().flat_map(json_image_urls).collect(),
        Value::Object(_) => json_string_field(value, "url")
            .or_else(|| json_string_field(value, "contentUrl"))
            .map(|url| vec![url.to_string()])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn page_description(document: &Html) -> Option<String> {
    [
        r#"meta[name="description"]"#,
        r#"meta[property="og:description"]"#,
        r#"meta[name="twitter:description"]"#,
    ]
    .into_iter()
    .filter_map(|selector| Selector::parse(selector).ok())
    .find_map(|selector| {
        document
            .select(&selector)
            .next()
            .and_then(|meta| meta.attr("content"))
            .map(normalize_whitespace)
            .filter(|content| !content.is_empty())
    })
    .or_else(|| {
        let selector = Selector::parse(r#"script[type="application/ld+json"]"#).ok()?;
        document.select(&selector).find_map(|script| {
            let text = script.text().collect::<String>();
            serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|value| json_description(&value))
        })
    })
}

fn element_noise_signature(element: &ElementRef<'_>) -> String {
    ["id", "class", "role", "aria-label"]
        .into_iter()
        .filter_map(|attr| element.attr(attr))
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn is_noise_element(element: &ElementRef<'_>) -> bool {
    let tag_name = element.value().name();
    if matches!(tag_name, "script" | "style" | "noscript" | "svg" | "iframe") {
        return true;
    }
    if matches!(tag_name, "html" | "body") {
        return false;
    }

    let signature = element_noise_signature(element);
    !signature.is_empty()
        && NOISE_ATTRIBUTE_KEYWORDS
            .iter()
            .any(|keyword| signature.contains(keyword))
}

fn has_noise_ancestor(element: &ElementRef<'_>) -> bool {
    is_noise_element(element)
        || element
            .ancestors()
            .filter_map(ElementRef::wrap)
            .any(|ancestor| is_noise_element(&ancestor))
}

fn is_noise_text(text: &str) -> bool {
    let normalized = normalize_whitespace(text);
    if normalized.is_empty() {
        return true;
    }

    let lower = normalized.to_lowercase();
    let char_count = normalized.chars().count();
    char_count <= 80
        && NOISE_TEXT_KEYWORDS
            .iter()
            .any(|keyword| lower.contains(&keyword.to_lowercase()))
}

fn page_title(document: &Html) -> String {
    let selector = Selector::parse("title").unwrap();
    document
        .select(&selector)
        .next()
        .map(|title| normalize_whitespace(&title.text().collect::<String>()))
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| "网页总结".to_string())
}

fn collect_page_images(
    content: &ElementRef<'_>,
    page_url: &Url,
    seen: &mut HashSet<String>,
    image_selector: &Selector,
    caption_selector: &Selector,
) -> Vec<PageImage> {
    content
        .select(image_selector)
        .filter(|image| !has_noise_ancestor(image))
        .filter_map(|image| {
            let src = candidate_image_url(&image)
                .and_then(|raw_src| absolute_image_url(page_url, &raw_src))?;
            if !seen.insert(src.clone()) {
                return None;
            }

            let alt = image
                .attr("alt")
                .map(normalize_whitespace)
                .unwrap_or_default();
            let title = image
                .attr("title")
                .map(normalize_whitespace)
                .unwrap_or_default();
            let caption = image_caption(&image, caption_selector);

            Some(PageImage {
                src,
                alt,
                title,
                caption,
            })
        })
        .collect()
}

fn collect_structured_data_images(
    document: &Html,
    page_url: &Url,
    seen: &mut HashSet<String>,
) -> Vec<PageImage> {
    let Ok(selector) = Selector::parse(r#"script[type="application/ld+json"]"#) else {
        return Vec::new();
    };

    document
        .select(&selector)
        .filter_map(|script| {
            let text = script.text().collect::<String>();
            serde_json::from_str::<Value>(&text).ok()
        })
        .flat_map(|value| {
            value
                .get("image")
                .map(json_image_urls)
                .unwrap_or_default()
                .into_iter()
        })
        .filter_map(|raw_src| absolute_image_url(page_url, &raw_src))
        .filter(|src| seen.insert(src.clone()))
        .map(|src| PageImage {
            src,
            alt: String::new(),
            title: String::new(),
            caption: String::new(),
        })
        .collect()
}

fn image_context_text(images: &[PageImage]) -> String {
    if images.is_empty() {
        return String::new();
    }

    let lines = images
        .iter()
        .take(WEBPAGE_IMAGE_LIMIT)
        .enumerate()
        .map(|(index, image)| {
            let description = [
                (!image.alt.is_empty()).then(|| format!("alt：{}", image.alt)),
                (!image.title.is_empty()).then(|| format!("title：{}", image.title)),
                (!image.caption.is_empty()).then(|| format!("caption：{}", image.caption)),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join("；");

            if description.is_empty() {
                format!("{}. {}", index + 1, image.src)
            } else {
                format!("{}. {} ({})", index + 1, image.src, description)
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!("\n\n图片信息：\n{}", lines)
}

fn page_text(html: &str, page_url: &Url) -> Result<(String, String), String> {
    let document = Html::parse_document(html);
    let title = page_title(&document);
    let description = page_description(&document);
    let content_selector = Selector::parse(
        r#"article, main, [role="main"], .article, .post, .entry-content, .post-content, .article-content, .content, body"#,
    )
    .map_err(|err| err.to_string())?;
    let block_selector = Selector::parse(
        "h1, h2, h3, h4, p, li, blockquote, pre, .content, .content-d-bot, .pin-content, .pin-content-row, [data-jj-helper=\"pin-content\"]",
    )
    .map_err(|err| err.to_string())?;
    let image_selector = Selector::parse("img").map_err(|err| err.to_string())?;
    let caption_selector = Selector::parse("figcaption").map_err(|err| err.to_string())?;

    let mut best_text = String::new();
    let mut best_images = Vec::new();
    let mut seen_page_images = HashSet::new();

    for content in document.select(&content_selector) {
        if has_noise_ancestor(&content) {
            continue;
        }

        let mut seen = HashSet::new();
        let blocks = content
            .select(&block_selector)
            .filter(|block| !has_noise_ancestor(block))
            .filter_map(|block| {
                let text = normalize_whitespace(&block.text().collect::<Vec<_>>().join(" "));
                if is_noise_text(&text) || !seen.insert(text.clone()) {
                    return None;
                }
                Some(text)
            })
            .collect::<Vec<_>>();
        let candidate = blocks.join("\n");
        let images = collect_page_images(
            &content,
            page_url,
            &mut seen_page_images,
            &image_selector,
            &caption_selector,
        );

        if candidate.chars().count() > best_text.chars().count() {
            best_text = candidate;
            best_images = images;
        }
    }

    let mut text = best_text.trim().to_string();
    if text.chars().count() < WEBPAGE_MIN_TEXT_LENGTH {
        if let Some(description) = description {
            text = description;
        }
    }

    let meaningful_len = format!("{} {}", title, text).chars().count();
    if text.chars().count() < WEBPAGE_MIN_TEXT_LENGTH
        && meaningful_len < WEBPAGE_MIN_TEXT_LENGTH * 2
    {
        return Err("网页正文太短，无法生成有效总结".to_string());
    }

    best_images.extend(collect_structured_data_images(
        &document,
        page_url,
        &mut seen_page_images,
    ));
    let readable_content = format!("{}{}", text, image_context_text(&best_images));

    Ok((
        title,
        readable_content.chars().take(WEBPAGE_TEXT_LIMIT).collect(),
    ))
}

fn parse_ai_note(content: &str, raw_markdown_title: &str) -> AiNoteDraft {
    let trimmed = content.trim();
    let json_text = trimmed
        .strip_prefix("```json")
        .and_then(|text| text.strip_suffix("```"))
        .or_else(|| {
            trimmed
                .strip_prefix("```")
                .and_then(|text| text.strip_suffix("```"))
        })
        .unwrap_or(trimmed)
        .trim();

    if let Ok(parsed) = serde_json::from_str::<SummaryJson>(json_text) {
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
    let trimmed = content.trim();
    let json_text = trimmed
        .strip_prefix("```json")
        .and_then(|text| text.strip_suffix("```"))
        .or_else(|| {
            trimmed
                .strip_prefix("```")
                .and_then(|text| text.strip_suffix("```"))
        })
        .unwrap_or(trimmed)
        .trim();

    serde_json::from_str::<AiTermsJson>(json_text)
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

    Ok(format!(
        "请结合文章主题为指定名词补充说明。要求：用中文；不要覆盖、复述或改写已有简释；只补充它在本文中的具体含义、为什么重要、和文章主旨的关系；不要泛泛百科化；输出 Markdown，不要输出 JSON；控制在 250 字以内。\n\n文章标题：{}\n名词：{}\n已有简释：{}\n已有上下文：{}\n文章内容：\n{}",
        if source_title.is_empty() {
            "未命名笔记"
        } else {
            source_title
        },
        clean_term,
        explanation.trim(),
        context.trim(),
        article
    ))
}

fn parse_knowledge_graph(content: &str) -> Option<KnowledgeGraph> {
    let trimmed = content.trim();
    let json_text = trimmed
        .strip_prefix("```json")
        .and_then(|text| text.strip_suffix("```"))
        .or_else(|| {
            trimmed
                .strip_prefix("```")
                .and_then(|text| text.strip_suffix("```"))
        })
        .unwrap_or(trimmed)
        .trim();

    serde_json::from_str::<KnowledgeGraph>(json_text).ok()
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
    let prompt = format!(
        "请总结下面的网页内容。要求：用中文；保留关键结论、事实、数据和行动建议；如图片信息与正文理解有关，在 Markdown 正文中用简短说明保留，并可使用 ![说明](图片地址) 引用图片；忽略广告、推广、赞助、导航、评论、相关推荐、订阅弹窗等非正文内容；输出严格 JSON，格式为 {{\"title\":\"不超过24字的中文笔记标题\",\"summary\":\"Markdown 正文\"}}。\n\n网页标题：{}\n网页地址：{}\n网页正文：\n{}",
        source_title,
        parsed_url,
        readable_text
    );

    let content = AiClient::new()?
        .chat_text(
            vec![
                AiMessage::system("你是一个擅长提炼网页信息的中文笔记助手。"),
                AiMessage::user(prompt),
            ],
            0.2,
        )
        .await?;

    let mut summary = parse_ai_note(&content, &format!("AI总结：{}", source_title));
    if summary.title.is_empty() {
        summary.title = format!("AI总结：{}", source_title);
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
pub async fn explain_article_terms(title: String, content: String) -> Result<Vec<AiTerm>, String> {
    let source_title = title.trim();
    let article = compact_article_content(&content);
    if article.chars().count() < 80 {
        return Err("当前文章内容太短，无法分析需要解释的名词".to_string());
    }

    let prompt = format!(
        "请分析下面这篇文章，找出读者可能需要解释的专业名词、缩写、概念、机构名、技术术语或背景概念。要求：只选真正影响理解的名词，不要罗列普通词；最多 12 个；用中文解释；输出严格 JSON，格式为 {{\"terms\":[{{\"term\":\"名词\",\"explanation\":\"一句话简明定义\",\"context\":\"它在本文中的含义或必要背景\"}}]}}。\n\n文章标题：{}\n文章内容：\n{}",
        if source_title.is_empty() {
            "未命名笔记"
        } else {
            source_title
        },
        article
    );

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
pub async fn explain_article_term(
    title: String,
    content: String,
    term: String,
    explanation: String,
    context: String,
) -> Result<String, String> {
    let prompt = build_term_supplement_prompt(&title, &content, &term, &explanation, &context)?;

    AiClient::new()?
        .chat_text(
            vec![
                AiMessage::system("你是一个擅长结合文章语境解释概念的中文知识助手。"),
                AiMessage::user(prompt),
            ],
            0.2,
        )
        .await
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

    let prompt = format!(
        "请围绕指定名词，结合文章主题生成局部知识图谱。要求：中心节点必须是该名词；节点总数 5 到 9 个；只包含文章语境中真正相关的概念、对象、机制或背景；关系标签要短，例如“影响”“依赖”“属于”“导致”“对比”“应用于”；输出严格 JSON，不要 Markdown，不要解释。格式为 {{\"nodes\":[{{\"id\":\"稳定英文或拼音ID\",\"label\":\"节点名称\",\"node_type\":\"term|concept|entity|mechanism|background\"}}],\"edges\":[{{\"source\":\"节点ID\",\"target\":\"节点ID\",\"label\":\"关系\",\"description\":\"一句话说明关系\"}}]}}。\n\n文章标题：{}\n中心名词：{}\n已有简释：{}\n已有上下文：{}\n文章内容：\n{}",
        if source_title.is_empty() {
            "未命名笔记"
        } else {
            source_title
        },
        clean_term,
        explanation.trim(),
        context.trim(),
        article
    );

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
    fn page_text_keeps_short_juejin_pin_content() {
        let html = r#"
            <html lang="zh">
              <head>
                <title>做开发时觉得创业开店很容易 - 酸奶瓶 - 沸点 - 掘金</title>
                <meta name="description" content="酸奶瓶：做开发时觉得创业开店很容易，其实做起来很难，光选址就能难倒一堆人，要考虑选品、客流、租金、建店成本等问题，感觉还不如坐班写代码轻松点[听歌]">
                <script type="application/ld+json">
                  {
                    "@type": "BlogPosting",
                    "image": ["https://p9-juejin-sign.byteimg.com/example.awebp"]
                  }
                </script>
              </head>
              <body>
                <main>
                  <span class="content content-d-bot">做开发时觉得创业开店很容易，其实做起来很难，光选址就能难倒一堆人，要考虑选品、客流、租金、建店成本等问题，感觉还不如坐班写代码轻松点</span>
                </main>
              </body>
            </html>
        "#;
        let url = Url::parse("https://juejin.cn/pin/7637174891143036969").unwrap();

        let (_title, text) = page_text(html, &url).expect("pin text should be readable");

        assert!(text.contains("光选址就能难倒一堆人"));
        assert!(text.contains("图片信息"));
        assert!(text.contains("https://p9-juejin-sign.byteimg.com/example.awebp"));
    }

    #[test]
    fn page_text_keeps_mdbook_content_when_root_has_sidebar_class() {
        let html = r##"
            <!DOCTYPE html>
            <html lang="en" class="light sidebar-visible" dir="ltr">
              <head>
                <title>Installation - The Rust Programming Language</title>
              </head>
              <body>
                <nav id="mdbook-sidebar" class="sidebar">
                  <a href="ch01-00-getting-started.html">Getting Started</a>
                </nav>
                <div id="mdbook-content" class="content">
                  <main>
                    <h1 id="installation"><a class="header" href="#installation">Installation</a></h1>
                    <p>The first step is to install Rust. We’ll download Rust through rustup, a command line tool for managing Rust versions and associated tools.</p>
                    <h3 id="command-line-notation"><a class="header" href="#command-line-notation">Command Line Notation</a></h3>
                    <p>In this chapter and throughout the book, we’ll show some commands used in the terminal.</p>
                  </main>
                </div>
              </body>
            </html>
        "##;
        let url = Url::parse("https://doc.rust-lang.org/book/ch01-01-installation.html").unwrap();

        let (_title, text) = page_text(html, &url).expect("mdbook text should be readable");

        assert!(text.contains("The first step is to install Rust"));
        assert!(text.contains("Command Line Notation"));
        assert!(!text.contains("Getting Started"));
    }
}
