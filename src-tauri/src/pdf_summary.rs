use crate::ai::{parse_ai_note, AiClient, AiMessage, AiNoteDraft};
use crate::base::sql::{
    get_pdf_chunks, get_pdf_document, get_pdf_outline_items, PdfChunk, PdfDocument, PdfOutlineItem,
};
use futures_util::{stream, StreamExt};
use serde::Serialize;
use tauri::ipc::Channel;

const DIRECT_SUMMARY_CHAR_LIMIT: usize = 25_000;
const BATCH_TARGET_CHAR_LIMIT: usize = 18_000;
const BATCH_MAX_CHAR_LIMIT: usize = 22_000;
const FINAL_INPUT_CHAR_LIMIT: usize = 30_000;
const AGGREGATE_INPUT_CHAR_LIMIT: usize = 22_000;
const OUTLINE_CHAR_LIMIT: usize = 8_000;
const BATCH_SUMMARY_TARGET_CHARS: usize = 1_200;
const BATCH_SUMMARY_CONCURRENCY: usize = 3;
const BATCH_SUMMARY_MAX_ATTEMPTS: usize = 3;
const AGGREGATE_SUMMARY_CONCURRENCY: usize = 2;
const AGGREGATE_SUMMARY_MAX_ATTEMPTS: usize = 2;
const BATCH_PROGRESS_END: f32 = 90.0;
const AGGREGATE_PROGRESS_END: f32 = 98.0;
const FINAL_MERGE_MAX_ATTEMPTS: usize = 2;
const BATCH_FALLBACK_EXCERPT_CHAR_LIMIT: usize = 1_800;
const BATCH_SUMMARY_MODEL: &str = "deepseek-chat";

struct SummaryBatch<'a> {
    page_start: i64,
    page_end: i64,
    chunks: Vec<&'a PdfChunk>,
    char_count: usize,
}

struct BatchSummaryRequest {
    index: usize,
    page_start: i64,
    page_end: i64,
    char_count: usize,
    prompt: String,
    fallback_summary: String,
}

struct BatchSummaryResult {
    index: usize,
    summary: String,
    error: Option<String>,
}

struct AggregateSummaryGroup {
    index: usize,
    batch_start: usize,
    batch_end: usize,
    summaries: Vec<(usize, String)>,
    char_count: usize,
}

struct AggregateSummaryRequest {
    index: usize,
    batch_start: usize,
    batch_end: usize,
    prompt: String,
    fallback_summary: String,
}

struct AggregateSummaryResult {
    index: usize,
    summary: String,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct PdfSummaryProgress {
    progress: f32,
    message: String,
    current: usize,
    total: usize,
}

fn char_count(text: &str) -> usize {
    text.chars().count()
}

fn truncate_chars(text: &str, limit: usize) -> String {
    let mut chars = text.chars();
    let truncated = chars.by_ref().take(limit).collect::<String>();
    if chars.next().is_some() {
        format!("{}\n\n[内容过长，已截断]", truncated.trim())
    } else {
        truncated
    }
}

fn send_progress(
    channel: &Channel<PdfSummaryProgress>,
    progress: f32,
    message: impl Into<String>,
    current: usize,
    total: usize,
) {
    let progress = progress.clamp(0.0, 100.0);
    let _ = channel.send(PdfSummaryProgress {
        progress,
        message: message.into(),
        current,
        total,
    });
}

fn document_label(document: &PdfDocument) -> String {
    let page_count = if document.page_count > 0 {
        document.page_count.to_string()
    } else {
        "未知".to_string()
    };

    format!(
        "文件名：{}\n页数：{}\n文件大小：{} bytes",
        document.name, page_count, document.size
    )
}

fn format_outline(outline_items: &[PdfOutlineItem], limit: usize) -> String {
    if outline_items.is_empty() {
        return "无内置目录".to_string();
    }

    let outline = outline_items
        .iter()
        .map(|item| {
            let indent = "  ".repeat(item.level.saturating_sub(1) as usize);
            let page = item
                .page_number
                .map(|page| format!("第 {} 页", page))
                .unwrap_or_else(|| "页码未知".to_string());
            format!("{}- {}（{}）", indent, item.title.trim(), page)
        })
        .collect::<Vec<_>>()
        .join("\n");

    truncate_chars(&outline, limit)
}

fn outline_for_page_range(
    outline_items: &[PdfOutlineItem],
    page_start: i64,
    page_end: i64,
) -> String {
    let matched = outline_items
        .iter()
        .filter(|item| {
            item.page_number
                .map(|page| page >= page_start && page <= page_end)
                .unwrap_or(false)
        })
        .cloned()
        .collect::<Vec<_>>();

    if !matched.is_empty() {
        return format_outline(&matched, OUTLINE_CHAR_LIMIT.min(3_000));
    }

    let nearest = outline_items
        .iter()
        .filter(|item| {
            item.page_number
                .map(|page| page <= page_end)
                .unwrap_or(false)
        })
        .max_by_key(|item| item.page_number.unwrap_or(0))
        .cloned()
        .into_iter()
        .collect::<Vec<_>>();

    if nearest.is_empty() {
        "无匹配目录项".to_string()
    } else {
        format_outline(&nearest, 1_000)
    }
}

fn format_chunks(chunks: &[&PdfChunk], limit: usize) -> String {
    let content = chunks
        .iter()
        .map(|chunk| {
            format!(
                "## 第 {}-{} 页 / 切片 {}\n{}",
                chunk.page_start,
                chunk.page_end,
                chunk.chunk_index + 1,
                chunk.content.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    truncate_chars(&content, limit)
}

fn build_batches(chunks: &[PdfChunk]) -> Vec<SummaryBatch<'_>> {
    let mut batches = Vec::new();
    let mut current_chunks = Vec::new();
    let mut current_chars = 0usize;
    let mut page_start = 0;
    let mut page_end = 0;

    for chunk in chunks {
        let chunk_chars = char_count(&chunk.content);
        let next_chars = current_chars + chunk_chars;
        let should_flush = !current_chunks.is_empty()
            && (next_chars > BATCH_MAX_CHAR_LIMIT || current_chars >= BATCH_TARGET_CHAR_LIMIT);

        if should_flush {
            batches.push(SummaryBatch {
                page_start,
                page_end,
                chunks: current_chunks,
                char_count: current_chars,
            });
            current_chunks = Vec::new();
            current_chars = 0;
        }

        if current_chunks.is_empty() {
            page_start = chunk.page_start;
        }
        page_end = chunk.page_end;
        current_chars += chunk_chars;
        current_chunks.push(chunk);
    }

    if !current_chunks.is_empty() {
        batches.push(SummaryBatch {
            page_start,
            page_end,
            chunks: current_chunks,
            char_count: current_chars,
        });
    }

    batches
}

fn build_direct_prompt(
    document: &PdfDocument,
    outline_items: &[PdfOutlineItem],
    chunks: &[PdfChunk],
) -> String {
    let chunk_refs = chunks.iter().collect::<Vec<_>>();
    format!(
        "请把 PDF 内容整理成一篇可直接保存的中文阅读笔记。\n\n# PDF 信息\n{}\n\n# 目录\n{}\n\n# PDF 文本切片\n{}\n\n# 输出要求\n输出严格 JSON，格式为 {{\"title\":\"不超过24字的中文笔记标题\",\"summary\":\"Markdown 正文\"}}。\nsummary 必须包含这些二级标题：\n## 一句话概览\n## 核心结论\n## 章节脉络\n## 关键事实和数据\n## 重要概念\n## 可行动启发\n## 来源信息\n\n要求：只依据提供的 PDF 内容；保留页码线索；不要编造图片、表格或未出现的数据；如果信息不足要明确说明。",
        document_label(document),
        format_outline(outline_items, OUTLINE_CHAR_LIMIT),
        format_chunks(&chunk_refs, DIRECT_SUMMARY_CHAR_LIMIT + 5_000)
    )
}

fn build_batch_prompt(
    document: &PdfDocument,
    outline_items: &[PdfOutlineItem],
    batch: &SummaryBatch<'_>,
) -> String {
    format!(
        "请为 PDF 的一个局部页段生成中间摘要，供后续合并成全文总结。不要输出 JSON，只输出 Markdown。\n\n# PDF 信息\n{}\n\n# 当前页段\n第 {}-{} 页，共约 {} 字。\n\n# 相关目录\n{}\n\n# 页段内容\n{}\n\n# 输出要求\n使用中文；控制在 {} 字以内；保留页码；不要编造未出现的信息；必须包含：\n### 第 {}-{} 页\n- 核心内容：\n- 关键事实和数据：\n- 重要概念：\n- 对全文结论的贡献：",
        document_label(document),
        batch.page_start,
        batch.page_end,
        batch.char_count,
        outline_for_page_range(outline_items, batch.page_start, batch.page_end),
        format_chunks(&batch.chunks, BATCH_MAX_CHAR_LIMIT),
        BATCH_SUMMARY_TARGET_CHARS,
        batch.page_start,
        batch.page_end
    )
}

fn build_batch_fallback_summary(batch: &SummaryBatch<'_>) -> String {
    let excerpt = format_chunks(&batch.chunks, BATCH_FALLBACK_EXCERPT_CHAR_LIMIT);
    format!(
        "### 第 {}-{} 页\n- 核心内容：该页段的 AI 局部摘要请求失败，最终总结只能参考原文摘录，可靠性低于正常批次。\n- 关键事实和数据：请以原文摘录为准，避免把未验证的信息写成确定结论。\n- 重要概念：该页段概念未能自动提炼。\n- 对全文结论的贡献：该页段覆盖不完整，最终总结应在来源信息中说明。\n\n#### 原文摘录\n{}",
        batch.page_start, batch.page_end, excerpt
    )
}

async fn summarize_batch_with_compensation(
    client: &AiClient,
    request: BatchSummaryRequest,
) -> BatchSummaryResult {
    let mut last_error = None;

    for _ in 1..=BATCH_SUMMARY_MAX_ATTEMPTS {
        match client
            .chat_text_with_model_without_reasoning(
                BATCH_SUMMARY_MODEL,
                vec![
                    AiMessage::system("你是一个擅长为 PDF 页段生成中间摘要的中文阅读助手。直接输出摘要，不输出思考过程。"),
                    AiMessage::user(request.prompt.clone()),
                ],
                0.2,
            )
            .await
        {
            Ok(summary) => {
                return BatchSummaryResult {
                    index: request.index,
                    summary,
                    error: None,
                };
            }
            Err(err) => {
                last_error = Some(err);
            }
        }
    }

    let error = last_error.unwrap_or_else(|| "未知错误".to_string());
    BatchSummaryResult {
        index: request.index,
        summary: format!(
            "{}\n\n- 异常说明：第 {}-{} 页局部摘要连续 {} 次失败，最后错误：{}",
            request.fallback_summary,
            request.page_start,
            request.page_end,
            BATCH_SUMMARY_MAX_ATTEMPTS,
            error
        ),
        error: Some(format!(
            "第 {}-{} 页，约 {} 字：{}",
            request.page_start, request.page_end, request.char_count, error
        )),
    }
}

fn format_numbered_summaries(summaries: &[String], heading: &str) -> String {
    summaries
        .iter()
        .enumerate()
        .map(|(index, summary)| format!("## {} {}\n{}", heading, index + 1, summary.trim()))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn final_input_char_count(summaries: &[String]) -> usize {
    char_count(&format_numbered_summaries(summaries, "局部摘要"))
}

fn build_aggregate_groups(batch_summaries: &[String]) -> Vec<AggregateSummaryGroup> {
    let mut groups = Vec::new();
    let mut summaries = Vec::new();
    let mut char_count_total = 0usize;
    let mut batch_start = 0usize;
    let mut batch_end = 0usize;

    for (index, summary) in batch_summaries.iter().enumerate() {
        let entry_chars = char_count(summary) + 32;
        let should_flush =
            !summaries.is_empty() && char_count_total + entry_chars > AGGREGATE_INPUT_CHAR_LIMIT;

        if should_flush {
            groups.push(AggregateSummaryGroup {
                index: groups.len(),
                batch_start,
                batch_end,
                summaries,
                char_count: char_count_total,
            });
            summaries = Vec::new();
            char_count_total = 0;
        }

        if summaries.is_empty() {
            batch_start = index + 1;
        }
        batch_end = index + 1;
        char_count_total += entry_chars;
        summaries.push((index + 1, summary.clone()));
    }

    if !summaries.is_empty() {
        groups.push(AggregateSummaryGroup {
            index: groups.len(),
            batch_start,
            batch_end,
            summaries,
            char_count: char_count_total,
        });
    }

    groups
}

fn build_aggregate_prompt(document: &PdfDocument, group: &AggregateSummaryGroup) -> String {
    let summaries = group
        .summaries
        .iter()
        .map(|(index, summary)| format!("## 局部摘要 {}\n{}", index, summary.trim()))
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        "请把一组 PDF 局部摘要压缩聚合成一个中间摘要，供最终全文总结使用。不要输出 JSON，只输出 Markdown。\n\n# PDF 信息\n{}\n\n# 当前摘要范围\n局部摘要 {}-{}，输入约 {} 字。\n\n# 局部摘要\n{}\n\n# 输出要求\n使用中文；控制在 2500 字以内；保留关键页码和章节线索；合并重复观点；不要编造未出现的信息；必须包含：\n### 聚合摘要 {}-{}\n- 核心结论：\n- 章节脉络：\n- 关键事实和数据：\n- 重要概念：\n- 覆盖范围和缺口：",
        document_label(document),
        group.batch_start,
        group.batch_end,
        group.char_count,
        truncate_chars(&summaries, AGGREGATE_INPUT_CHAR_LIMIT),
        group.batch_start,
        group.batch_end
    )
}

fn build_aggregate_fallback_summary(group: &AggregateSummaryGroup) -> String {
    let summaries = group
        .summaries
        .iter()
        .map(|(index, summary)| format!("### 局部摘要 {}\n{}", index, summary.trim()))
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        "### 聚合摘要 {}-{}\n- 核心结论：该组聚合摘要请求失败，以下保留局部摘要摘录供最终合并参考。\n- 章节脉络：未完成自动聚合。\n- 关键事实和数据：请以下方局部摘要摘录为准。\n- 重要概念：未完成自动聚合。\n- 覆盖范围和缺口：局部摘要 {}-{} 聚合失败。\n\n#### 局部摘要摘录\n{}",
        group.batch_start,
        group.batch_end,
        group.batch_start,
        group.batch_end,
        truncate_chars(&summaries, AGGREGATE_INPUT_CHAR_LIMIT)
    )
}

async fn aggregate_summary_group_with_compensation(
    client: &AiClient,
    request: AggregateSummaryRequest,
) -> AggregateSummaryResult {
    let mut last_error = None;

    for _ in 1..=AGGREGATE_SUMMARY_MAX_ATTEMPTS {
        match client
            .chat_text_with_model_without_reasoning(
                BATCH_SUMMARY_MODEL,
                vec![
                    AiMessage::system("你是一个擅长压缩和聚合 PDF 局部摘要的中文阅读助手。直接输出摘要，不输出思考过程。"),
                    AiMessage::user(request.prompt.clone()),
                ],
                0.2,
            )
            .await
        {
            Ok(summary) => {
                return AggregateSummaryResult {
                    index: request.index,
                    summary,
                    error: None,
                };
            }
            Err(err) => {
                last_error = Some(err);
            }
        }
    }

    let error = last_error.unwrap_or_else(|| "未知错误".to_string());
    AggregateSummaryResult {
        index: request.index,
        summary: format!(
            "{}\n\n- 异常说明：局部摘要 {}-{} 聚合连续 {} 次失败，最后错误：{}",
            request.fallback_summary,
            request.batch_start,
            request.batch_end,
            AGGREGATE_SUMMARY_MAX_ATTEMPTS,
            error
        ),
        error: Some(format!(
            "局部摘要 {}-{}：{}",
            request.batch_start, request.batch_end, error
        )),
    }
}

async fn aggregate_summaries_if_needed(
    client: &AiClient,
    document: &PdfDocument,
    batch_summaries: Vec<String>,
    failed_batch_errors: &mut Vec<String>,
    progress: &Channel<PdfSummaryProgress>,
) -> Result<Vec<String>, String> {
    let mut current_summaries = batch_summaries;
    let mut round = 0usize;

    while final_input_char_count(&current_summaries) > FINAL_INPUT_CHAR_LIMIT
        && current_summaries.len() > 1
    {
        round += 1;
        let groups = build_aggregate_groups(&current_summaries);
        let total_groups = groups.len();
        send_progress(
            progress,
            BATCH_PROGRESS_END,
            format!("第 {} 轮聚合摘要，共 {} 组", round, total_groups),
            0,
            total_groups,
        );

        let requests = groups
            .into_iter()
            .map(|group| AggregateSummaryRequest {
                index: group.index,
                batch_start: group.batch_start,
                batch_end: group.batch_end,
                prompt: build_aggregate_prompt(document, &group),
                fallback_summary: build_aggregate_fallback_summary(&group),
            })
            .collect::<Vec<_>>();

        let mut summary_slots = vec![None; total_groups];
        let mut completed_groups = 0usize;
        let mut aggregate_stream = stream::iter(requests.into_iter())
            .map(|request| aggregate_summary_group_with_compensation(client, request))
            .buffer_unordered(AGGREGATE_SUMMARY_CONCURRENCY);

        while let Some(result) = aggregate_stream.next().await {
            completed_groups += 1;
            if let Some(error) = result.error {
                failed_batch_errors.push(error);
            }
            summary_slots[result.index] = Some(result.summary);
            let progress_value = BATCH_PROGRESS_END
                + (completed_groups as f32 / total_groups as f32)
                    * (AGGREGATE_PROGRESS_END - BATCH_PROGRESS_END);
            send_progress(
                progress,
                progress_value,
                format!("第 {} 轮聚合 {}/{}", round, completed_groups, total_groups),
                completed_groups,
                total_groups,
            );
        }

        let next_summaries = summary_slots
            .into_iter()
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| "PDF 聚合摘要生成不完整".to_string())?;

        if next_summaries.len() >= current_summaries.len() {
            return Ok(next_summaries);
        }
        current_summaries = next_summaries;
    }

    Ok(current_summaries)
}

fn build_final_prompt(
    document: &PdfDocument,
    outline_items: &[PdfOutlineItem],
    batch_summaries: &[String],
) -> String {
    let summaries = format_numbered_summaries(batch_summaries, "局部摘要");

    format!(
        "请把多个 PDF 局部摘要合并成一篇可直接保存的中文阅读笔记。\n\n# PDF 信息\n{}\n\n# 目录\n{}\n\n# 局部摘要\n{}\n\n# 输出要求\n输出严格 JSON，格式为 {{\"title\":\"不超过24字的中文笔记标题\",\"summary\":\"Markdown 正文\"}}。\nsummary 必须包含这些二级标题：\n## 一句话概览\n## 核心结论\n## 章节脉络\n## 关键事实和数据\n## 重要概念\n## 可行动启发\n## 来源信息\n\n要求：合并重复观点；保留关键页码；如果局部摘要没有覆盖图片、表格或扫描页，要在来源信息中说明总结主要基于可提取文本。",
        document_label(document),
        format_outline(outline_items, OUTLINE_CHAR_LIMIT),
        truncate_chars(&summaries, FINAL_INPUT_CHAR_LIMIT)
    )
}

fn format_failed_batches(failed_batch_errors: &[String]) -> String {
    if failed_batch_errors.is_empty() {
        return "无".to_string();
    }

    failed_batch_errors
        .iter()
        .map(|error| format!("- {}", error))
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_final_fallback_markdown(
    document: &PdfDocument,
    outline_items: &[PdfOutlineItem],
    batch_summaries: &[String],
    failed_batch_errors: &[String],
    merge_error: &str,
) -> String {
    let summaries = batch_summaries
        .iter()
        .enumerate()
        .map(|(index, summary)| format!("### 局部摘要 {}\n{}", index + 1, summary.trim()))
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        "## 一句话概览\n这份 PDF 笔记触发了异常补偿：最终合并请求失败，因此下面内容由局部摘要和失败批次摘录自动拼接生成。\n\n## 核心结论\n- 正常的全局合并没有完成，不能把本文档视为完整 AI 总结。\n- 已成功保留可用的局部摘要；失败批次用原文摘录补位。\n- 需要更高质量结论时，建议稍后重新生成。\n\n## 章节脉络\n{}\n\n## 关键事实和数据\n- 最终合并失败，关键事实和数据未经过全局去重与校验。\n- 请优先查看下方“局部摘要补偿材料”中的页码线索和原文摘录。\n\n## 重要概念\n- 最终合并失败，重要概念未完成全局归纳。\n\n## 可行动启发\n- 重新生成 PDF AI 总结以获得完整版本。\n- 如果失败集中在少数页段，可先检查对应页是否为扫描页、图片页或文本提取异常页。\n\n## 来源信息\n- 来源 PDF：{}\n- PDF 文档 ID：{}\n- 异常补偿：已启用\n- 批次补偿情况：\n{}\n- 最终合并错误：{}\n\n## 局部摘要补偿材料\n{}",
        format_outline(outline_items, OUTLINE_CHAR_LIMIT),
        document.name,
        document.id,
        format_failed_batches(failed_batch_errors),
        merge_error,
        truncate_chars(&summaries, FINAL_INPUT_CHAR_LIMIT)
    )
}

async fn merge_batch_summaries_with_compensation(
    client: &AiClient,
    document: &PdfDocument,
    outline_items: &[PdfOutlineItem],
    batch_summaries: &[String],
    failed_batch_errors: &[String],
) -> String {
    let prompt = build_final_prompt(document, outline_items, batch_summaries);
    let mut last_error = None;

    for _ in 1..=FINAL_MERGE_MAX_ATTEMPTS {
        match client
            .chat_text(
                vec![
                    AiMessage::system("你是一个擅长整合多段摘要并生成中文阅读笔记的助手。"),
                    AiMessage::user(prompt.clone()),
                ],
                0.2,
            )
            .await
        {
            Ok(content) => return content,
            Err(err) => {
                last_error = Some(err);
            }
        }
    }

    build_final_fallback_markdown(
        document,
        outline_items,
        batch_summaries,
        failed_batch_errors,
        &last_error.unwrap_or_else(|| "未知错误".to_string()),
    )
}

fn append_source_footer(content: &str, document: &PdfDocument, chunks: &[PdfChunk]) -> String {
    let footer = [
        "---".to_string(),
        "## 生成信息".to_string(),
        format!("- 来源 PDF：{}", document.name),
        format!("- PDF 文档 ID：{}", document.id),
        format!("- 文本切片：{} 个", chunks.len()),
        "- 生成方式：AI PDF 阅读笔记".to_string(),
        "- 说明：当前总结主要基于 PDF 可提取文本，不包含图片视觉理解或表格结构还原。".to_string(),
    ]
    .join("\n");

    let trimmed = content.trim();
    if trimmed.contains("## 生成信息") {
        trimmed.to_string()
    } else {
        format!("{}\n\n{}", trimmed, footer)
    }
}

async fn summarize_direct(
    client: &AiClient,
    document: &PdfDocument,
    outline_items: &[PdfOutlineItem],
    chunks: &[PdfChunk],
) -> Result<AiNoteDraft, String> {
    let content = client
        .chat_text(
            vec![
                AiMessage::system("你是一个擅长总结长 PDF 的中文阅读笔记助手。"),
                AiMessage::user(build_direct_prompt(document, outline_items, chunks)),
            ],
            0.2,
        )
        .await?;

    Ok(parse_ai_note(
        &content,
        &format!("AI总结：{}", document.name),
    ))
}

async fn summarize_batched(
    client: &AiClient,
    document: &PdfDocument,
    outline_items: &[PdfOutlineItem],
    chunks: &[PdfChunk],
    progress: &Channel<PdfSummaryProgress>,
) -> Result<AiNoteDraft, String> {
    let batches = build_batches(chunks);
    let total_batches = batches.len();
    send_progress(
        progress,
        0.0,
        format!("开始生成局部摘要，共 {} 批", total_batches),
        0,
        total_batches,
    );
    let mut batch_requests = Vec::with_capacity(total_batches);
    for (index, batch) in batches.iter().enumerate() {
        let prompt = build_batch_prompt(document, outline_items, batch);
        let fallback_summary = build_batch_fallback_summary(batch);
        batch_requests.push(BatchSummaryRequest {
            index,
            page_start: batch.page_start,
            page_end: batch.page_end,
            char_count: batch.char_count,
            prompt,
            fallback_summary,
        });
    }

    let mut batch_summary_slots = vec![None; total_batches];
    let mut failed_batch_errors = Vec::new();
    let mut completed_batches = 0usize;
    let mut batch_stream = stream::iter(batch_requests.into_iter())
        .map(|request| summarize_batch_with_compensation(client, request))
        .buffer_unordered(BATCH_SUMMARY_CONCURRENCY);

    while let Some(result) = batch_stream.next().await {
        completed_batches += 1;
        if let Some(error) = result.error {
            failed_batch_errors.push(error);
        }
        batch_summary_slots[result.index] = Some(result.summary);
        send_progress(
            progress,
            (completed_batches as f32 / total_batches as f32) * BATCH_PROGRESS_END,
            format!("局部摘要 {}/{}", completed_batches, total_batches),
            completed_batches,
            total_batches,
        );
    }
    let batch_summaries = batch_summary_slots
        .into_iter()
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| "PDF 局部摘要生成不完整".to_string())?;
    let final_summaries = aggregate_summaries_if_needed(
        client,
        document,
        batch_summaries,
        &mut failed_batch_errors,
        progress,
    )
    .await?;

    send_progress(
        progress,
        AGGREGATE_PROGRESS_END,
        "整合最终总结",
        total_batches,
        total_batches,
    );

    let content = merge_batch_summaries_with_compensation(
        client,
        document,
        outline_items,
        &final_summaries,
        &failed_batch_errors,
    )
    .await;

    send_progress(progress, 100.0, "AI 总结完成", total_batches, total_batches);

    Ok(parse_ai_note(
        &content,
        &format!("AI总结：{}", document.name),
    ))
}

#[tauri::command]
pub async fn summarize_pdf_document(
    pdf_document_id: i64,
    progress: Channel<PdfSummaryProgress>,
) -> Result<AiNoteDraft, String> {
    let document = get_pdf_document(pdf_document_id)?;
    let outline_items = get_pdf_outline_items(pdf_document_id)?;
    let chunks = get_pdf_chunks(pdf_document_id)?;
    if chunks.is_empty() {
        return Err("当前 PDF 还没有文本切片，请先生成切片".to_string());
    }

    let total_chars = chunks
        .iter()
        .map(|chunk| char_count(&chunk.content))
        .sum::<usize>();
    let client = AiClient::new()?;
    let mut note = if total_chars <= DIRECT_SUMMARY_CHAR_LIMIT {
        send_progress(&progress, 2.0, "生成 AI 总结", 0, 1);
        let note = summarize_direct(&client, &document, &outline_items, &chunks).await?;
        send_progress(&progress, 100.0, "AI 总结完成", 1, 1);
        note
    } else {
        summarize_batched(&client, &document, &outline_items, &chunks, &progress).await?
    };

    if note.title.trim().is_empty() {
        note.title = format!("AI总结：{}", document.name);
    }
    if note.content.trim().is_empty() {
        return Err("AI 没有返回可保存的 PDF 总结".to_string());
    }

    note.content = append_source_footer(&note.content, &document, &chunks);
    Ok(note)
}
