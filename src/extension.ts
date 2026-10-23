import * as vscode from 'vscode';
import * as fs from 'fs';
import { Book, paginate } from './book';
import { EpubBook } from './epubBook';

/**
 * 本地文件书籍实现
 */
class FileBook implements Book {
    private _chapters: string[] = [];
    private _chapterTitles: string[] = [];
    private _formattedChapters: string[][] = []; // [chapterIndex][pageIndex] -> pageContent
    
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
            this.loadDefaultChapter("未配置路径", "请在设置中配置 vscode-reader.filePath 指向您的 txt 文件。");
            return;
        }

        if (!fs.existsSync(this._filePath)) {
            this.loadDefaultChapter("文件未找到", `无法找到文件: ${this._filePath}`);
            return;
        }

        try {
            const content = fs.readFileSync(this._filePath, 'utf-8');
            this.parseChapters(content);
            this.reformatAll();
        } catch (err: any) {
            this.loadDefaultChapter("读取错误", `读取文件失败: ${err.message}`);
        }
    }

    private loadDefaultChapter(title: string, content: string) {
        this._chapterTitles = [title];
        this._chapters = [content];
        this.reformatAll();
    }

    private parseChapters(content: string) {
        // 匹配 "第x章" 或 "Chapter x"
        const chapterRegex = /(^\s*第[0-9零一二三四五六七八九十百千]+[章回].*)|(^\s*Chapter\s+\d+.*)/gm;
        
        let match;
        const indices: number[] = [];
        
        while ((match = chapterRegex.exec(content)) !== null) {
            indices.push(match.index);
        }

        if (indices.length === 0) {
            this._chapterTitles = ["全书"];
            this._chapters = [content];
            return;
        }

        for (let i = 0; i < indices.length; i++) {
            const startIndex = indices[i];
            const endIndex = (i + 1 < indices.length) ? indices[i + 1] : content.length;
            const rawSection = content.substring(startIndex, endIndex);
            
            const firstLineEnd = rawSection.indexOf('\n');
            let title = rawSection.substring(0, firstLineEnd > 0 ? firstLineEnd : rawSection.length).trim();
            // 标题原始截断（后续在UI层再进行显示截断）
            if (title.length > 50) {
                title = title.substring(0, 50) + "...";
            }

            this._chapterTitles.push(title);
            this._chapters.push(rawSection);
        }
        
        if (indices[0] > 0) {
            const preContent = content.substring(0, indices[0]).trim();
            if (preContent.length > 0) {
                this._chapterTitles.unshift("序言/前言");
                this._chapters.unshift(preContent);
            }
        }
    }

    public reformatAll() {
        this._formattedChapters = [];
        this._chapters.forEach(chapterText => {
            this._formattedChapters.push(this.formatAndPaginate(chapterText));
        });
    }

    private formatAndPaginate(fullText: string): string[] {
        return paginate(fullText, this._linesPerPage, this._charsPerLine);
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

export function activate(context: vscode.ExtensionContext) {
    const book = new DispatchBook();
    const reader = new Reader(book, context.globalState);

    // 异步初始化
    book.init().then(() => {
        console.log("vscode-reader: Book initialized");
        reader.restoreProgress();
    });

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, reader),
        reader,
        vscode.commands.registerCommand('vscode-reader.toggle', () => reader.toggle()),
        vscode.commands.registerCommand('vscode-reader.nextChapter', () => reader.next()),
        vscode.commands.registerCommand('vscode-reader.prevChapter', () => reader.prev()),
        vscode.commands.registerCommand('vscode-reader.jumpChapter', () => reader.jump()),
        vscode.commands.registerCommand('vscode-reader.pickBook', () => pickBook()),
        
        // 配置监听
        vscode.workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration('vscode-reader')) {
                return;
            }

            book.reloadConfig();
            
            if (e.affectsConfiguration('vscode-reader.filePath')) {
                book.init().then(() => {
                    reader.reset();
                    reader.reload();
                    vscode.window.showInformationMessage('小说文件已重新加载');
                });
            } else {
                // 仅排版变化
                book.reformatAll();
                reader.reload();
            }
        })
    );
}

export function deactivate() {}

/**
 * 打开文件选择器挑选 .txt / .epub 书籍，写回 vscode-reader.filePath
 */
async function pickBook() {
    const config = vscode.workspace.getConfiguration('vscode-reader');
    const inspected = config.inspect<string>('filePath');

    // 对话框起始目录：当前书籍所在目录
    const currentPath = inspected?.workspaceFolderValue || inspected?.workspaceValue || inspected?.globalValue;
    const defaultUri = currentPath ? vscode.Uri.file(currentPath) : undefined;

    const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        canSelectFolders: false,
        defaultUri,
        openLabel: '选择书籍文件',
        filters: {
            '书籍文件 (txt/epub)': ['txt', 'epub'],
            '纯文本 (txt)': ['txt'],
            'EPUB 电子书 (epub)': ['epub']
        }
    });
    if (!uris || uris.length === 0) {
        return;
    }

    // 写回与当前值相同的作用域；当前未配置时写全局
    let target = vscode.ConfigurationTarget.Global;
    if (inspected?.workspaceFolderValue !== undefined) {
        target = vscode.ConfigurationTarget.WorkspaceFolder;
    } else if (inspected?.workspaceValue !== undefined) {
        target = vscode.ConfigurationTarget.Workspace;
    }
    await config.update('filePath', uris[0].fsPath, target);
}

/**
 * 按文件后缀分发：.epub → EpubBook，其余 → FileBook（.txt）
 */
class DispatchBook implements Book {
    private _current: Book;

    constructor() {
        this._current = this._create();
    }

    private _create(): Book {
        const p = vscode.workspace.getConfiguration('vscode-reader').get<string>('filePath', "");
        return p.toLowerCase().endsWith('.epub') ? new EpubBook() : new FileBook();
    }

    public async init(): Promise<void> {
        const wantEpub = vscode.workspace.getConfiguration('vscode-reader')
            .get<string>('filePath', "").toLowerCase().endsWith('.epub');
        if ((this._current instanceof EpubBook) !== wantEpub) {
            this._current = this._create();
        }
        await this._current.init();
    }

    public getTitle(chapterIndex: number): string {
        return this._current.getTitle(chapterIndex);
    }

    public getAllTitles(): string[] {
        return this._current.getAllTitles();
    }

    public getPageContent(chapterIndex: number, pageIndex: number): string {
        return this._current.getPageContent(chapterIndex, pageIndex);
    }

    public getChapterPageCount(chapterIndex: number): number {
        return this._current.getChapterPageCount(chapterIndex);
    }

    public getTotalChapters(): number {
        return this._current.getTotalChapters();
    }

    public reloadConfig(): void {
        this._current.reloadConfig();
    }

    public reformatAll(): void {
        this._current.reformatAll();
    }
}

class Reader implements vscode.InlineCompletionItemProvider, vscode.Disposable {
    private _isEnabled: boolean = false;
    private _currentChapterIndex: number = 0;
    private _currentPageIndex: number = 0;
    private _statusBarItem: vscode.StatusBarItem;

    private readonly STORAGE_KEY_CHAPTER = 'reader.chapterIndex';
    private readonly STORAGE_KEY_PAGE = 'reader.pageIndex';

    constructor(
        private readonly _book: Book,
        private readonly _storage: vscode.Memento
    ) {
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this._statusBarItem.command = 'vscode-reader.toggle';
        this._statusBarItem.tooltip = "点击关闭阅读模式";
    }

    public dispose() {
        this._statusBarItem.dispose();
    }

    public restoreProgress() {
        this._currentChapterIndex = this._storage.get<number>(this.STORAGE_KEY_CHAPTER, 0);
        this._currentPageIndex = this._storage.get<number>(this.STORAGE_KEY_PAGE, 0);
        this.checkBoundary();
    }

    private saveProgress() {
        this._storage.update(this.STORAGE_KEY_CHAPTER, this._currentChapterIndex);
        this._storage.update(this.STORAGE_KEY_PAGE, this._currentPageIndex);
    }

    public reset() {
        this._currentChapterIndex = 0;
        this._currentPageIndex = 0;
        this.saveProgress();
    }

    public reload() {
        this.checkBoundary();
        this.refreshContent();
    }

    /**
     * 边界检查，防止页码/章节溢出
     */
    private checkBoundary() {
        const totalChapters = this._book.getTotalChapters();
        if (this._currentChapterIndex >= totalChapters) {
            this._currentChapterIndex = 0;
            this._currentPageIndex = 0;
            return;
        }
        const totalPages = this._book.getChapterPageCount(this._currentChapterIndex);
        if (this._currentPageIndex >= totalPages) {
            this._currentPageIndex = Math.max(0, totalPages - 1);
        }
    }

    public toggle() {
        this._isEnabled = !this._isEnabled;
        vscode.commands.executeCommand('setContext', 'vscode-reader.isReading', this._isEnabled);
        if (this._isEnabled) {
            this._statusBarItem.show();
            this.refreshContent();
        } else {
            this._statusBarItem.hide();
            vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
        }
    }

    public next() {
        const totalPages = this._book.getChapterPageCount(this._currentChapterIndex);
        
        if (this._currentPageIndex < totalPages - 1) {
            this._currentPageIndex++;
            this.saveProgress();
            this.refreshContent();
        } else {
            if (this._currentChapterIndex < this._book.getTotalChapters() - 1) {
                this._currentChapterIndex++;
                this._currentPageIndex = 0;
                this.saveProgress();
                this.refreshContent();
            } else {
                this.showTempMessage('$(warning) 已经是全书最后一页');
            }
        }
    }

    public prev() {
        if (this._currentPageIndex > 0) {
            this._currentPageIndex--;
            this.saveProgress();
            this.refreshContent();
        } else {
            if (this._currentChapterIndex > 0) {
                this._currentChapterIndex--;
                this._currentPageIndex = this._book.getChapterPageCount(this._currentChapterIndex) - 1;
                this.saveProgress();
                this.refreshContent();
            } else {
                this.showTempMessage('$(warning) 已经是全书第一页');
            }
        }
    }

    public async jump() {
        const titles = this._book.getAllTitles();
        if (titles.length === 0) {
            vscode.window.showWarningMessage('章节列表为空');
            return;
        }

        const items = titles.map((title, index) => ({
            label: `${index + 1}. ${title}`,
            index: index
        }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: '搜索或选择要跳转的章节',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (picked) {
            this._currentChapterIndex = picked.index;
            this._currentPageIndex = 0;
            this.saveProgress();
            this.refreshContent();
            
            // 如果当前没有启用，提示用户开启
            if (!this._isEnabled) {
                this.showTempMessage('已跳转，请点击状态栏图标或运行 toggle 命令开启阅读');
            } else {
                this.showTempMessage(`已跳转到: ${picked.label}`);
            }
        }
    }

    private refreshContent() {
        this.updateStatusBar();
        if (this._isEnabled) {
            // 保持 Promise 链式调用以确保时序
            vscode.commands.executeCommand('editor.action.inlineSuggest.hide').then(() => {
                vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
            });
        }
    }

    private updateStatusBar() {
        let title = this._book.getTitle(this._currentChapterIndex);
        // 限制标题长度，节省空间
        if (title.length > 8) {
            title = title.substring(0, 8) + '...';
        }
        
        const totalPages = this._book.getChapterPageCount(this._currentChapterIndex);
        this._statusBarItem.text = `$(book) ${title} (${this._currentPageIndex + 1}/${totalPages})`;
    }
    
    private showTempMessage(msg: string) {
        vscode.window.setStatusBarMessage(msg, 2000);
    }

    public provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
        
        if (!this._isEnabled) {
            return [];
        }

        const text = this._book.getPageContent(this._currentChapterIndex, this._currentPageIndex);
        const item = new vscode.InlineCompletionItem(text);
        item.range = new vscode.Range(position, position);
        return [item];
    }
}
