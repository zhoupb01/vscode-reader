import * as vscode from 'vscode';
import * as fs from 'fs';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { Book, paginate } from './book';

/**
 * ZIP 内部路径规范化：处理 ../ 与 ./
 */
function normalizeZipPath(p: string): string {
    const parts = p.split('/');
    const out: string[] = [];
    for (const part of parts) {
        if (part === '' || part === '.') {
            continue;
        }
        if (part === '..') {
            out.pop();
            continue;
        }
        out.push(part);
    }
    return out.join('/');
}

function ensureArray<T>(v: T | T[] | undefined | null): T[] {
    if (Array.isArray(v)) {
        return v;
    }
    return v ? [v] : [];
}

const NAMED_ENTITIES: Record<string, string> = {
    'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'", 'nbsp': ' ',
    'hellip': '…', 'mdash': '—', 'ndash': '–', 'lsquo': '\u2018', 'rsquo': '\u2019',
    'ldquo': '\u201C', 'rdquo': '\u201D', 'copy': '©', 'middot': '·', 'bull': '•'
};

function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '');
}

/**
 * 解码 HTML 实体（数字实体 + 常见命名实体）
 */
export function decodeEntities(s: string): string {
    let out = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
    out = out.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
    out = out.replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m);
    return out;
}

/**
 * XHTML/HTML 转纯文本：剥样式脚本、块级标签转换行、解码实体
 */
export function htmlToText(html: string): string {
    let s = html;
    s = s.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer|nav|dd|dt|figcaption)>/gi, '\n');
    s = s.replace(/<[^>]+>/g, '');
    s = decodeEntities(s);
    s = s.replace(/[ \t]+/g, ' ');
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim();
}

/**
 * 从 XHTML 中提取章节标题：优先正文章节标题 h1-h3，其次 <title>，取不到用 fallback
 * （不少 EPUB 的 <title> 是书卷名而非章节名，h1 才是真章节名）
 */
export function extractTitle(html: string, fallback: string): string {
    const clamp = (t: string) => (t.length > 50 ? t.substring(0, 50) + '...' : t);
    for (const tag of ['h1', 'h2', 'h3']) {
        const m = html.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
        if (m) {
            const t = decodeEntities(stripTags(m[1])).trim();
            if (t) {
                return clamp(t);
            }
        }
    }
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m) {
        const t = decodeEntities(stripTags(m[1])).trim();
        if (t) {
            return clamp(t);
        }
    }
    return fallback;
}

/**
 * 判断是否为目录/封面等无需阅读的导航类文档
 */
const NON_CONTENT_TITLE_RE = /^(总?目录|table of contents|contents|封面|封底|版权(信息|页|声明)?|copyright|colophon|about the author|作者简介)$/i;

export function isNonContentTitle(title: string): boolean {
    return NON_CONTENT_TITLE_RE.test(title.trim());
}

export interface ParsedEpub {
    titles: string[];
    chapters: string[];
}

/**
 * 解析 EPUB（ZIP）为纯文本章节列表
 * 链路：container.xml → OPF → spine 顺序 → 逐个 XHTML → 纯文本
 */
export async function parseEpub(data: Buffer): Promise<ParsedEpub> {
    const zip = await JSZip.loadAsync(data);

    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) {
        throw new Error('不是有效的 EPUB：缺少 META-INF/container.xml');
    }

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

    const cont = parser.parse(await containerFile.async('string'));
    const rootfiles = ensureArray(cont?.container?.rootfiles?.rootfile);
    const opfPath = rootfiles[0]?.['@_full-path'];
    if (!opfPath) {
        throw new Error('EPUB container.xml 中未找到 OPF 描述文件');
    }

    const opfFile = zip.file(opfPath);
    if (!opfFile) {
        throw new Error(`EPUB 中找不到 OPF 文件: ${opfPath}`);
    }

    const opf = parser.parse(await opfFile.async('string'));
    const pkg = opf?.package;
    if (!pkg) {
        throw new Error('EPUB OPF 文件解析失败');
    }

    // manifest: id → href / mediaType
    const manifest: Record<string, { href: string; mediaType: string }> = {};
    for (const it of ensureArray(pkg.manifest?.item)) {
        const id = it['@_id'];
        const href = it['@_href'];
        if (id && href) {
            manifest[id] = { href, mediaType: it['@_media-type'] || '' };
        }
    }

    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

    const titles: string[] = [];
    const chapters: string[] = [];
    const seenTitles = new Map<string, number>();
    let index = 1;

    for (const ref of ensureArray(pkg.spine?.itemref)) {
        const it = manifest[ref['@_idref']];
        if (!it) {
            continue;
        }
        if (it.mediaType && !/xhtml|html/i.test(it.mediaType)) {
            continue;
        }

        const raw = normalizeZipPath(opfDir ? opfDir + '/' + it.href : it.href);
        const entry = zip.file(raw) || zip.file(decodeURIComponent(raw)) || zip.file(it.href);
        if (!entry) {
            continue;
        }

        const html = await entry.async('string');
        const text = htmlToText(html);
        if (!text) {
            continue;
        }

        const rawTitle = extractTitle(html, `第 ${index} 节`);
        // 跳过目录/封面等导航类文档
        if (isNonContentTitle(rawTitle)) {
            continue;
        }

        // 重名消歧：同名标题追加序号
        const n = (seenTitles.get(rawTitle) || 0) + 1;
        seenTitles.set(rawTitle, n);
        const title = n > 1 ? `${rawTitle}（${n}）` : rawTitle;

        titles.push(title);
        chapters.push(text);
        index++;
    }

    if (chapters.length === 0) {
        throw new Error('EPUB 中未提取到任何文本内容');
    }

    return { titles, chapters };
}

/**
 * EPUB 书籍实现
 */
export class EpubBook implements Book {
    private _chapters: string[] = [];
    private _chapterTitles: string[] = [];
    private _formattedChapters: string[][] = [];

    private _linesPerPage: number = 15;
    private _charsPerLine: number = 50;
    private _filePath: string = "";

    constructor() {
        this.reloadConfig();
    }

    public reloadConfig() {
        const config = vscode.workspace.getConfiguration('vscode-reader');
        this._linesPerPage = config.get<number>('linesPerPage', 15);
        this._charsPerLine = config.get<number>('charsPerLine', 50);
        this._filePath = config.get<string>('filePath', "");
    }

    public async init(): Promise<void> {
        this._chapters = [];
        this._chapterTitles = [];
        this._formattedChapters = [];

        if (!this._filePath) {
            this.loadDefaultChapter("未配置路径", "请在设置中配置 vscode-reader.filePath 指向您的 .epub 文件。");
            return;
        }

        if (!fs.existsSync(this._filePath)) {
            this.loadDefaultChapter("文件未找到", `无法找到文件: ${this._filePath}`);
            return;
        }

        try {
            const data = fs.readFileSync(this._filePath);
            const parsed = await parseEpub(data);
            this._chapterTitles = parsed.titles;
            this._chapters = parsed.chapters;
            this.reformatAll();
        } catch (err: any) {
            this.loadDefaultChapter("读取错误", `EPUB 解析失败: ${err.message}`);
        }
    }

    private loadDefaultChapter(title: string, content: string) {
        this._chapterTitles = [title];
        this._chapters = [content];
        this.reformatAll();
    }

    public reformatAll() {
        this._formattedChapters = [];
        this._chapters.forEach(chapterText => {
            this._formattedChapters.push(paginate(chapterText, this._linesPerPage, this._charsPerLine));
        });
    }

    public getTitle(index: number): string {
        return this._chapterTitles[index] || "";
    }

    public getAllTitles(): string[] {
        return this._chapterTitles;
    }

    public getPageContent(chapterIndex: number, pageIndex: number): string {
        const pages = this._formattedChapters[chapterIndex];
        return pages ? (pages[pageIndex] || "") : "";
    }

    public getChapterPageCount(chapterIndex: number): number {
        const pages = this._formattedChapters[chapterIndex];
        return pages ? pages.length : 0;
    }

    public getTotalChapters(): number {
        return this._chapters.length;
    }
}
