use reqwest::Url;
use scraper::{ElementRef, Html, Selector};
use serde_json::Value;
use std::collections::HashSet;

const WEBPAGE_TEXT_LIMIT: usize = 18_000;
const WEBPAGE_IMAGE_LIMIT: usize = 12;
const WEBPAGE_MIN_TEXT_LENGTH: usize = 30;
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

#[derive(Clone)]
struct PageImage {
    src: String,
    alt: String,
    title: String,
    caption: String,
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

pub fn page_text(html: &str, page_url: &Url) -> Result<(String, String), String> {
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
