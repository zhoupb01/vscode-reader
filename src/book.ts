/**
 * Book 抽象接口与共享分页工具
 */
export interface Book {
    init(): Promise<void>;
    getTitle(chapterIndex: number): string;
    getAllTitles(): string[];
    getPageContent(chapterIndex: number, pageIndex: number): string;
    getChapterPageCount(chapterIndex: number): number;
    getTotalChapters(): number;
    reloadConfig(): void;
    reformatAll(): void;
}

/**
 * 将整章纯文本按"每行 charsPerLine 字符、每页 linesPerPage 行"分页
 */
export function paginate(fullText: string, linesPerPage: number, charsPerLine: number): string[] {
    const lines: string[] = [];
    let currentLine = "";

    for (let i = 0; i < fullText.length; i++) {
        const char = fullText[i];

        if (char === '\n') {
            if (currentLine.trim().length > 0 || (lines.length > 0 && lines[lines.length - 1].trim().length > 0)) {
                lines.push(currentLine);
            }
            currentLine = "";
            continue;
        }

        if (char === '\r') {
            continue;
        }

        currentLine += char;

        if (currentLine.length >= charsPerLine) {
            lines.push(currentLine);
            currentLine = "";
        }
    }
    if (currentLine) {
        lines.push(currentLine);
    }

    if (lines.length === 0) {
        return ["(本章空)"];
    }

    const pages: string[] = [];
    for (let i = 0; i < lines.length; i += linesPerPage) {
        pages.push(lines.slice(i, i + linesPerPage).join('\n'));
    }

    return pages;
}
