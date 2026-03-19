const fs = require('fs');
const txt = fs.readFileSync('fb_desktop_messages.html', 'utf8');

// The HTML contains a giant JSON object wrapped in handleWithCustomApplyEach / require.
// But we can extract the JSON strings via regex and parse them.
const scriptMatch = txt.match(/<script[^>]*>.*?LSPlatformGraphQLLightspeedRequestQuery.*?<\/script>/);
if (scriptMatch) {
    fs.writeFileSync('debug_excerpt.txt', scriptMatch[0]);
} else {
    fs.writeFileSync('debug_excerpt.txt', 'NOT FOUND scriptMatch');
}
