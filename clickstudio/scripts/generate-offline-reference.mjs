import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const referenceRoot = process.argv[2];
const sourceRevision = process.argv[3];

if (!referenceRoot || !sourceRevision) {
    throw new Error(
        'Usage: node scripts/generate-offline-reference.mjs <ClickHouse docs/reference directory> <source commit>',
    );
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(scriptDirectory, '../shared/offline-reference-catalog.json');
const entries = [];

async function markdownFiles(directory) {
    const output = [];
    for (const item of await readdir(directory, { withFileTypes: true })) {
        if (item.name.startsWith('_') || item.name === 'navigation.json') continue;
        const absolutePath = path.join(directory, item.name);
        if (item.isDirectory()) output.push(...(await markdownFiles(absolutePath)));
        else if (/\.mdx?$/.test(item.name) && !/^(?:index|README)\.mdx?$/i.test(item.name))
            output.push(absolutePath);
    }
    return output.sort();
}

function readYamlValue(frontmatter, key) {
    const lines = frontmatter.split(/\r?\n/);
    const start = lines.findIndex(line => line.startsWith(`${key}:`));
    if (start < 0) return '';
    const first = lines[start].slice(key.length + 1).trim();
    const valueLines = [first];
    if (first === '|' || first === '>') {
        for (let index = start + 1; index < lines.length && /^\s+/.test(lines[index]); index++)
            valueLines.push(lines[index].trim());
        return valueLines
            .slice(1)
            .join(first === '>' ? ' ' : '\n')
            .trim();
    }
    if (
        (first.startsWith("'") && !first.endsWith("'")) ||
        (first.startsWith('"') && !first.endsWith('"'))
    ) {
        const quote = first[0];
        for (let index = start + 1; index < lines.length; index++) {
            valueLines.push(lines[index].trim());
            if (lines[index].trimEnd().endsWith(quote)) break;
        }
    }
    let value = valueLines.join(' ').trim();
    if (value.startsWith("'") && value.endsWith("'"))
        value = value.slice(1, -1).replaceAll("''", "'");
    else if (value.startsWith('"') && value.endsWith('"')) {
        try {
            value = JSON.parse(value);
        } catch {
            value = value.slice(1, -1);
        }
    }
    return value.replace(/\s+/g, ' ').trim();
}

function splitDocument(source) {
    const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
    if (!match) return { frontmatter: '', body: source };
    return { frontmatter: match[1], body: source.slice(match[0].length) };
}

function categoryFor(relativePath) {
    const parts = relativePath.split(path.sep);
    if (parts[0] === 'functions') {
        if (parts[1] === 'aggregate-functions') return 'Aggregate Function';
        if (parts[1] === 'table-functions') return 'Table Function';
        return 'Function';
    }
    if (parts[0] === 'data-types') return 'Data Type';
    if (parts[0] === 'engines')
        return parts[1] === 'database-engines' ? 'Database Engine' : 'Table Engine';
    if (parts[0] === 'formats') return 'Format';
    if (parts[0] === 'settings') {
        if (parts[1] === 'server-settings') return 'Server Setting';
        if (parts[1] === 'merge-tree-settings') return 'MergeTree Setting';
        if (parts[1] === 'formats') return 'Format Setting';
        return 'Setting';
    }
    if (parts[0] === 'system-tables') return 'System Table';
    if (parts[0] === 'statements') return 'SQL Statement';
    if (parts[0] === 'operators') return 'SQL Operator';
    if (parts[0] === 'interfaces') return 'Protocol';
    if (relativePath === 'syntax.mdx') return 'SQL Syntax';
    return undefined;
}

function cleanContent(value) {
    return value
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/<!--([\s\S]*?)-->/g, '')
        .replace(/^import\s+.*$/gm, '')
        .replace(/^export\s+.*$/gm, '')
        .replace(/^\s*<\/?[A-Z][\w.]*\b[^>]*>\s*$/gm, '')
        .replace(/^\s*\{[^\n]*\}\s*$/gm, '')
        .replace(
            /\]\((\/(?:reference|sql-reference|operations)\/[^)]+)\)/g,
            '] (https://clickhouse.com/docs$1)',
        )
        .replace(/\]\s+\(/g, '](')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function codeBlocks(body) {
    return [...body.matchAll(/```([^\n`]*)\n([\s\S]*?)\n```/g)].map(match => ({
        info: match[1].trim(),
        code: match[2].trim(),
    }));
}

function excerptFor(frontmatter, body) {
    const frontDescription = readYamlValue(frontmatter, 'description');
    const prose = cleanContent(body.replace(/```[^\n`]*\n[\s\S]*?\n```/g, ''))
        .replace(/^#{1,6}\s+.*$/gm, '')
        .split(/\n\s*\n/)
        .map(part => part.trim())
        .filter(
            part =>
                part &&
                !part.split('\n').every(line => /^\s*\|/.test(line)) &&
                !/^\*\*(?:See also|Syntax|Arguments|Returned value|Examples|Example)\*\*$/i.test(
                    part,
                ),
        );
    const paragraphs = [];
    let length = 0;
    for (const paragraph of [frontDescription, ...prose]) {
        if (!paragraph) continue;
        const available = 850 - length;
        if (available <= 0) break;
        const trimmed = paragraph.slice(0, available).trim();
        if (trimmed) paragraphs.push(trimmed);
        length += trimmed.length;
    }
    const sql = codeBlocks(body).filter(
        block => /^sql(?:\s|$)/i.test(block.info) && block.code.length <= 1800,
    );
    const example =
        sql.find(block => /title\s*=\s*["']?Query\b/i.test(block.info)) ??
        sql.find(block => block.code.length <= 1000);
    if (example) paragraphs.push(`**Example**\n\n\`\`\`sql\n${example.code}\n\`\`\``);
    return cleanContent(paragraphs.join('\n\n'));
}

function sectionSegments(body) {
    const headings = [...body.matchAll(/^##\s+(.+?)(?:\s+\{#([^}]+)\})?\s*$/gm)];
    return headings.map((heading, index) => ({
        title: heading[1].replace(/\s+\{#[^}]+\}$/, '').trim(),
        anchor: heading[2] ?? '',
        body: body.slice(
            heading.index + heading[0].length,
            headings[index + 1]?.index ?? body.length,
        ),
    }));
}

function nameFor(category, title, relativePath) {
    let name = title || path.basename(relativePath, path.extname(relativePath));
    name = name
        .replace(/^system\./i, '')
        .replace(/\s+(?:table|database) engine$/i, '')
        .trim();
    if (category === 'SQL Syntax') return 'SQL syntax';
    return name;
}

function splitTypeNames(title) {
    const names = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < title.length; index++) {
        if (title[index] === '(') depth++;
        else if (title[index] === ')') depth = Math.max(0, depth - 1);
        else if (title[index] === ',' && depth === 0) {
            names.push(title.slice(start, index).trim());
            start = index + 1;
        }
    }
    names.push(title.slice(start).trim());
    return names.filter(Boolean);
}

function addEntry(name, type, description, source) {
    const cleanName = name.trim().replace(/^system\./i, '');
    if (!cleanName || !description) return;
    entries.push({ name: cleanName, type, description, source });
}

for (const file of await markdownFiles(referenceRoot)) {
    const relativePath = path.relative(referenceRoot, file);
    const type = categoryFor(relativePath);
    if (!type) continue;
    const source = await readFile(file, 'utf8');
    const { frontmatter, body: rawBody } = splitDocument(source);
    const title = readYamlValue(frontmatter, 'title');
    const body = rawBody
        .replace(/\{\/\*AUTOGENERATED_START\*\/\}/, '')
        .replace(/\{\/\*AUTOGENERATED_END\*\/\}/, '');
    const sourcePath = readYamlValue(frontmatter, 'slug');
    const sourceUrl = sourcePath
        ? `https://clickhouse.com/docs${sourcePath.replace(/\/$/, '')}`
        : `https://github.com/ClickHouse/ClickHouse/blob/${sourceRevision}/docs/reference/${relativePath.split(path.sep).join('/')}`;

    if (type.endsWith('Setting')) {
        const sections = sectionSegments(body).filter(
            section => section.anchor && /^[\w.*-]+$/.test(section.anchor),
        );
        if (sections.length) {
            for (const section of sections)
                addEntry(section.anchor, type, excerptFor(frontmatter, section.body), sourceUrl);
            continue;
        }
    }

    if (type === 'Data Type' && /int-uint\.mdx?$/i.test(relativePath)) {
        const integerNames = [
            ...body.matchAll(/^\|\s*`((?:U?Int)(?:8|16|32|64|128|256))`\s*\|/gm),
        ].map(match => match[1]);
        for (const name of new Set(integerNames))
            addEntry(name, type, excerptFor(frontmatter, body), sourceUrl);
        continue;
    }

    const description = excerptFor(frontmatter, body);
    const name = nameFor(type, title, relativePath);
    const names = type === 'Data Type' ? splitTypeNames(name) : [name];
    for (const entryName of names) addEntry(entryName, type, description, sourceUrl);

    const aliasLines = [...source.matchAll(/(?:\*\*)?Aliases?(?:\*\*)?:[^\n]*/gi)];
    for (const line of aliasLines) {
        for (const alias of line[0].matchAll(/`([^`]+)`/g)) {
            if (/^[A-Za-z_][\w]*$/.test(alias[1]) && alias[1].toLowerCase() !== name.toLowerCase())
                addEntry(alias[1], type, description, sourceUrl);
        }
    }
}

const uniqueEntries = [
    ...new Map(entries.map(entry => [`${entry.type}\u0000${entry.name}`, entry])).values(),
].sort((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name));
await writeFile(
    outputPath,
    `${JSON.stringify({ source: 'ClickHouse documentation', sourceRevision, license: 'CC BY-NC-SA 4.0', entries: uniqueEntries })}\n`,
);
console.log(`Wrote ${uniqueEntries.length} offline reference entries to ${outputPath}`);
