const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function runOrThrow(cmd, args, options) {
    const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${cmd} 실행 실패 (exit code: ${result.status})`);
    }
}

function resolveLocalBin(repoRoot, cmd) {
    const binName = process.platform === 'win32' ? `${cmd}.cmd` : cmd;
    const localBin = path.join(repoRoot, 'node_modules', '.bin', binName);
    if (fs.existsSync(localBin)) {
        return localBin;
    }
    return null;
}

function commandExists(cmd) {
    const result = spawnSync('bash', ['-lc', `command -v ${cmd} >/dev/null 2>&1`], { stdio: 'ignore' });
    return result.status === 0;
}

function parseFrontMatter(markdown) {
    const lines = markdown.split(/\r?\n/);
    let title = null;
    let docno = null;
    let docdate = null;
    let docauthor = null;

    const bodyLines = [];

    let i = 0;

    // Title
    if (lines[i] && lines[i].startsWith('# ')) {
        title = lines[i].slice(2).trim();
        i += 1;
    }

    // Optional blank lines
    while (i < lines.length && lines[i].trim() === '') {
        i += 1;
    }

    // Metadata lines
    for (; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = line.trim();

        const mDocNo = trimmed.match(/^\*\*문서번호:\*\*\s*(.+?)\s*$/);
        const mDate = trimmed.match(/^\*\*작성일:\*\*\s*(.+?)\s*$/);
        const mAuthor = trimmed.match(/^\*\*작성자:\*\*\s*(.+?)\s*$/);

        if (mDocNo) {
            docno = mDocNo[1];
            continue;
        }
        if (mDate) {
            docdate = mDate[1];
            continue;
        }
        if (mAuthor) {
            docauthor = mAuthor[1];
            continue;
        }

        // Stop when we hit the first horizontal rule or first heading/section
        if (trimmed === '---' || trimmed.startsWith('## ')) {
            break;
        }

        // If it's just formatting line breaks, skip
        if (trimmed === '') {
            continue;
        }

        // Unknown line -> stop parsing metadata and include from here
        break;
    }

    // Skip leading separators
    while (i < lines.length && lines[i].trim() === '---') {
        i += 1;
    }

    // Skip one blank line after separator
    while (i < lines.length && lines[i].trim() === '') {
        i += 1;
    }

    for (; i < lines.length; i += 1) {
        bodyLines.push(lines[i]);
    }

    const body = bodyLines.join('\n').trim() + '\n';

    return { title, docno, docdate, docauthor, body };
}

function findMermaidBlocks(markdown) {
    const blocks = [];
    const lines = markdown.split(/\r?\n/);

    let inBlock = false;
    let current = [];

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!inBlock && line.trim() === '```mermaid') {
            inBlock = true;
            current = [];
            continue;
        }
        if (inBlock && line.trim() === '```') {
            blocks.push(current.join('\n'));
            inBlock = false;
            current = [];
            continue;
        }
        if (inBlock) {
            current.push(line);
        }
    }

    return blocks;
}

function replaceMermaidWithImages(markdown, imagePaths) {
    let out = markdown;
    for (const imgPath of imagePaths) {
        // Replace one block at a time, in order
        out = out.replace(/```mermaid[\s\S]*?```\s*/m, `![](${imgPath})\n\n`);
    }
    return out;
}

function main() {
    const repoRoot = path.resolve(__dirname, '..');
    const configPath = path.join(repoRoot, 'docs', 'pdf', 'pandoc.config.json');

    if (!fs.existsSync(configPath)) {
        throw new Error(`설정 파일이 없습니다: ${configPath}`);
    }

    const config = readJson(configPath);

    if (!commandExists('pandoc')) {
        throw new Error('pandoc이 설치되어 있지 않습니다. pandoc 설치 후 다시 실행하세요.');
    }

    const pdfEngine = config.pdfEngine;
    if (!pdfEngine || typeof pdfEngine !== 'string') {
        throw new Error('pandoc.config.json에 pdfEngine이 필요합니다.');
    }

    if (!commandExists(pdfEngine)) {
        throw new Error(`${pdfEngine}가 설치되어 있지 않습니다. 설치 후 다시 실행하세요.`);
    }

    const inputDir = path.join(repoRoot, config.inputDir);
    const outputDir = path.join(repoRoot, config.outputDir);
    const tmpDir = path.join(repoRoot, config.tmpDir);
    const templatePath = path.join(repoRoot, config.template);

    if (!fs.existsSync(inputDir)) {
        throw new Error(`입력 폴더가 없습니다: ${inputDir}`);
    }

    if (!fs.existsSync(templatePath)) {
        throw new Error(`pandoc 템플릿이 없습니다: ${templatePath}`);
    }

    ensureDir(outputDir);
    ensureDir(tmpDir);

    const platformKey = process.platform === 'darwin' ? 'darwin' : 'linux';
    const fontConfig = (config.fonts && config.fonts[platformKey]) || null;

    if (!fontConfig || !fontConfig.mainfont || !fontConfig.cjkmainfont) {
        throw new Error(`폰트 설정이 누락되었습니다. pandoc.config.json의 fonts.${platformKey}를 확인하세요.`);
    }

    const markdownFiles = fs
        .readdirSync(inputDir)
        .filter((name) => name.toLowerCase().endsWith('.md'))
        .sort();

    if (markdownFiles.length === 0) {
        throw new Error(`변환할 마크다운 파일이 없습니다: ${inputDir}`);
    }

    for (const fileName of markdownFiles) {
        const srcPath = path.join(inputDir, fileName);
        const baseName = path.basename(fileName, path.extname(fileName));
        const dstPdfPath = path.join(outputDir, `${baseName}.pdf`);

        const raw = fs.readFileSync(srcPath, 'utf8');
        const parsed = parseFrontMatter(raw);

        if (!parsed.title) {
            throw new Error(`제목(H1)이 필요합니다: ${srcPath}`);
        }

        const mermaidBlocks = findMermaidBlocks(parsed.body);
        let bodyForPandoc = parsed.body;

        if (config.renderMermaid && mermaidBlocks.length > 0) {
            const mmdcPath = resolveLocalBin(repoRoot, 'mmdc') || (commandExists('mmdc') ? 'mmdc' : null);
            if (!mmdcPath) {
                throw new Error(
                    `Mermaid 다이어그램 렌더링이 필요하지만 mmdc가 없습니다.\n` +
                        `해결: npm install 후, npm i -D @mermaid-js/mermaid-cli 를 설치하거나 mmdc를 PATH에 추가하세요.\n` +
                        `대상 파일: ${srcPath}`
                );
            }

            // 컴파일 기준 경로(tmpDir)와 리소스 경로가 어긋나지 않도록 임시 폴더에 렌더링
            const assetDir = path.join(tmpDir, `${baseName}_assets`);
            ensureDir(assetDir);

            const imagePaths = [];
            for (let i = 0; i < mermaidBlocks.length; i += 1) {
                const mmdPath = path.join(tmpDir, `${baseName}.diagram.${i + 1}.mmd`);
                const outPngPath = path.join(assetDir, `diagram-${i + 1}.png`);

                fs.writeFileSync(mmdPath, mermaidBlocks[i], 'utf8');

                runOrThrow(mmdcPath, ['-i', mmdPath, '-o', outPngPath, '--backgroundColor', 'transparent'], {
                    cwd: repoRoot
                });

                const rel = path.relative(tmpDir, outPngPath).split(path.sep).join('/');
                imagePaths.push(rel);
            }

            bodyForPandoc = replaceMermaidWithImages(bodyForPandoc, imagePaths);
        }

        const tmpMdPath = path.join(tmpDir, `${baseName}.clean.md`);
        fs.writeFileSync(tmpMdPath, bodyForPandoc, 'utf8');

        const tmpTexPath = path.join(tmpDir, `${baseName}.tex`);

        // 1) pandoc: Markdown -> LaTeX (.tex)
        const pandocArgs = [
            '--from=markdown+pipe_tables+task_lists',
            '--standalone',
            '--template',
            templatePath,
            '--metadata',
            `title=${parsed.title}`,
            '--metadata',
            `docno=${parsed.docno || ''}`,
            '--metadata',
            `docdate=${parsed.docdate || ''}`,
            '--metadata',
            `docauthor=${parsed.docauthor || ''}`,
            '--metadata',
            `mainfont=${fontConfig.mainfont}`,
            '--metadata',
            `cjkmainfont=${fontConfig.cjkmainfont}`,
            '--metadata',
            'lang=ko-KR',
            '-t',
            'latex',
            '--output',
            tmpTexPath,
            tmpMdPath
        ];

        if (config.toc) {
            pandocArgs.push('--toc');
            pandocArgs.push('--toc-depth');
            pandocArgs.push(String(config.tocDepth || 2));
        }

        if (config.numberSections) {
            pandocArgs.push('--number-sections');
        }

        runOrThrow('pandoc', pandocArgs, { cwd: repoRoot });

        // 2) tectonic: LaTeX (.tex) -> PDF
        // pandoc가 pdf-engine으로 tectonic을 stdin 처리할 때 간헐적으로 LaTeX 매크로 인식 문제가 발생할 수 있어
        // 파일 입력으로 직접 컴파일한다.
        runOrThrow(
            pdfEngine,
            ['--format', 'latex', '--keep-logs', '--keep-intermediates', '--outfmt', 'pdf', '--outdir', outputDir, tmpTexPath],
            { cwd: repoRoot }
        );

        // tectonic 출력 파일은 <tex base name>.pdf 이므로 원하는 이름으로 정리
        const producedPdf = path.join(outputDir, `${baseName}.pdf`);
        if (!fs.existsSync(producedPdf)) {
            // 예상 경로에 없다면, outdir에 생성된 파일명을 확인하기 위해 명확히 실패
            throw new Error(`PDF 생성 결과를 찾을 수 없습니다: ${producedPdf}`);
        }

        // dstPdfPath는 producedPdf와 동일하지만, 혹시 outputDir 구성이 바뀌는 경우를 대비해 명시적으로 유지
        if (producedPdf !== dstPdfPath) {
            fs.copyFileSync(producedPdf, dstPdfPath);
        }
    }

    // 완료 메시지는 최소화 (스크립트 stdout을 깨끗하게 유지)
}

try {
    main();
} catch (err) {
    // 실패 시 원인과 해결 힌트를 명확히 노출
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
}
