/**
 * EPUB 解析冒烟测试（独立于 VS Code 运行）
 * 运行方式：
 *   npx esbuild scripts/test-epub.ts --bundle --platform=node --outfile=/tmp/epub-test.cjs && node /tmp/epub-test.cjs
 */
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { parseEpub } from '../src/epubBook';

async function buildSampleEpub(outPath: string): Promise<void> {
    const zip = new JSZip();

    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

    zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试之书</dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="text/chapter3.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="nav"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
  </spine>
</package>`);

    zip.file('OEBPS/nav.xhtml', `<html><head><title>目录</title></head><body><nav><ol><li><a href="text/chapter1.xhtml">第一章</a></li></ol></nav></body></html>`);
    zip.file('OEBPS/style.css', `body { color: red; }`);

    zip.file('OEBPS/text/chapter1.xhtml', `<html><head><title>第一章 初入江湖 &amp; 试炼</title>
<style>p { text-indent: 2em; }</style></head>
<body><h1>第一章 初入江湖 &amp; 试炼</h1>
<p>方林睁开眼，&lt;系统&gt;面板在视网膜上展开。</p>
<p>他深吸一口气，按下了确认键。</p></body></html>`);

    zip.file('OEBPS/text/chapter2.xhtml', `<html><head><title>第二章 淬体</title></head>
<body><h1>第二章 淬体</h1>
<p>三日后，&#x4ED6;&#20204;抵达山门。</p>
<p>老胡在天井里劈柴，火星四溅&mdash;&mdash;那是错觉，只有&#8230;&#8230;风声。</p></body></html>`);

    zip.file('OEBPS/text/chapter3.xhtml', `<html><head><title>第三章 无题之章</title></head>
<body><div><p>这一章没有 h1，只有 div 和 p。</p><p>用于测试标题回退到 title 标签。</p></div></body></html>`);

    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    fs.writeFileSync(outPath, buf);
    console.log(`[setup] 样本 EPUB 已生成: ${outPath} (${buf.length} bytes)`);
}

async function main() {
    const outPath = path.join('/tmp', `sample-book-${Date.now()}.epub`);
    await buildSampleEpub(outPath);

    const parsed = await parseEpub(fs.readFileSync(outPath));
    let failed = 0;
    const check = (name: string, cond: boolean, detail?: string) => {
        console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${detail ? ' | ' + detail : ''}`);
        if (!cond) { failed++; }
    };

    check('章节数应为 3（nav 目录页被跳过）', parsed.chapters.length === 3,
        `实际 ${parsed.chapters.length}: [${parsed.titles.join(' | ')}]`);
    check('章节标题包含"第一章"相关字样', parsed.titles.some(t => t.includes('第一章')));
    check('目录/封面类导航页被跳过', parsed.titles.every(t => t !== '目录' && !/table of contents/i.test(t)));
    check('标题中的 &amp; 实体已解码', parsed.titles[0] === '第一章 初入江湖 & 试炼', `实际: ${parsed.titles[0]}`);
    check('正文不含任何真实 HTML 标签',
        parsed.chapters.every(c => !/<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(c)));
    check('正文不含未解码实体', parsed.chapters.every(c => !/&[a-z]+;|#x?\d+;/i.test(c)));
    check('数字实体 &#x4ED6; 已解码为"他"', parsed.chapters.some(c => c.includes('他们抵达山门')));
    check('&mdash;&mdash; 解码为破折号', parsed.chapters.some(c => c.includes('——那是错觉')));
    check('style/script 内容被剥离', parsed.chapters.every(c => !c.includes('text-indent') && !c.includes('color: red')));
    check('第三章标题回退到 <title>', parsed.titles[2] === '第三章 无题之章', `实际: ${parsed.titles[2]}`);

    // 边界：损坏文件
    try {
        await parseEpub(Buffer.from('not a zip'));
        check('损坏文件应抛错', false);
    } catch (e: any) {
        check('损坏文件应抛错', /zip|EPUB|invalid/i.test(e.message) || e.message.length > 0, e.message);
    }

    // 边界：缺少 container.xml 的 zip
    const badZip = new JSZip();
    badZip.file('random.txt', 'hello');
    try {
        await parseEpub(await badZip.generateAsync({ type: 'nodebuffer' }));
        check('缺 container.xml 应抛错', false);
    } catch (e: any) {
        check('缺 container.xml 应抛错', e.message.includes('container.xml'), e.message);
    }

    fs.unlinkSync(outPath);
    console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('测试执行异常:', e); process.exit(1); });
