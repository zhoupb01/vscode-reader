/**
 * 真实 EPUB 文件实测脚本
 * 运行：npx esbuild scripts/inspect-epub.ts --bundle --platform=node --outfile=/tmp/inspect-epub.cjs --log-level=error --alias:vscode=./scripts/vscode-stub.cjs && node /tmp/inspect-epub.cjs "<epub路径>"
 */
import * as fs from 'fs';
import { parseEpub, htmlToText } from '../src/epubBook';

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('用法: node inspect-epub.cjs <epub路径>');
        process.exit(1);
    }

    const t0 = Date.now();
    const parsed = await parseEpub(fs.readFileSync(filePath));
    const t1 = Date.now();

    console.log(`解析耗时: ${t1 - t0}ms`);
    console.log(`章节数: ${parsed.chapters.length}`);
    console.log(`总字符数: ${parsed.chapters.reduce((a, c) => a + c.length, 0)}`);
    console.log('\n--- 前 10 个章节标题 ---');
    parsed.titles.slice(0, 10).forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    console.log('\n--- 中间 5 个章节标题 ---');
    const mid = Math.floor(parsed.titles.length / 2);
    parsed.titles.slice(mid, mid + 5).forEach((t, i) => console.log(`  ${mid + i + 1}. ${t}`));
    console.log('\n--- 最后 5 个章节标题 ---');
    parsed.titles.slice(-5).forEach((t, i) => console.log(`  ${parsed.titles.length - 5 + i + 1}. ${t}`));

    console.log('\n--- 质量抽检 ---');
    const emptyChapters = parsed.chapters.filter(c => c.trim().length < 5).length;
    console.log(`空章节(<5字符): ${emptyChapters}`);
    const tagLeak = parsed.chapters.filter(c => /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(c)).length;
    console.log(`残留 HTML 标签的章节: ${tagLeak}`);
    const entityLeak = parsed.chapters.filter(c => /&(amp|lt|gt|quot|apos|nbsp|mdash|hellip);/i.test(c)).length;
    console.log(`残留常见实体的章节: ${entityLeak}`);
    const titleFallback = parsed.titles.filter(t => /^第 \d+ 节$/.test(t)).length;
    console.log(`使用回退标题"第 N 节"的章节: ${titleFallback} / ${parsed.titles.length}`);

    console.log('\n--- 第一章正文预览(前 300 字) ---');
    console.log(parsed.chapters[0].substring(0, 300).replace(/\n/g, '\n'));

    // 分页模拟（默认 15 行 x 50 字符）
    let totalPages = 0;
    const linesPerPage = 15, charsPerLine = 50;
    for (const c of parsed.chapters) {
        const lineCount = Math.ceil(c.length / charsPerLine);
        totalPages += Math.ceil(lineCount / linesPerPage);
    }
    console.log(`\n估算总页数(15行x50字): ${totalPages}`);
}

main().catch(e => { console.error('解析失败:', e); process.exit(1); });
