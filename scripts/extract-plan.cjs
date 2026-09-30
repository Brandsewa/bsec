const fs = require('fs');
const html = fs.readFileSync('docs/PLAN.html', 'utf8');

function extractSection(startHeading, endHeading) {
  const startIdx = html.indexOf(startHeading);
  if (startIdx === -1) return 'NOT FOUND: ' + startHeading;
  const endIdx = endHeading ? html.indexOf(endHeading, startIdx + startHeading.length) : html.length;
  const raw = html.substring(startIdx, endIdx);
  return raw.replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .trim();
}

const args = process.argv.slice(2);
const start = args[0];
const end = args[1];
console.log(extractSection(start, end));
