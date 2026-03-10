const fs = require('fs');
const path = require('path');

const bots = ['cara', 'cindy', 'sienna', 'ceevee', 'scraper'];

bots.forEach(bot => {
  const filePath = path.join(__dirname, 'app', bot, 'page.tsx');
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Check if BotSwitcher is imported
    if (!content.includes('BotSwitcher')) {
      // It's missing entirely! We need to add it.
      const firstImport = content.indexOf('import ');
      if (firstImport !== -1) {
        content = content.slice(0, firstImport) + 'import { BotSwitcher } from "@/components/BotSwitcher";\n' + content.slice(firstImport);
      }
    }

    // Since I might have manually replaced Nav but forgot the import in some files, or completely wiped out the BotSwitcher component from rendering, let's verify if `<BotSwitcher` is rendered.
    if (!content.includes('<BotSwitcher')) {
       // Find where it should be inserted
       // It usually goes right after `<div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />`
       const anchor = '<div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />';
       const anchorIdx = content.indexOf(anchor);
       if (anchorIdx !== -1) {
           // check if we already have it
           const endAnchorIdx = anchorIdx + anchor.length;
           content = content.slice(0, endAnchorIdx) + `\n            <BotSwitcher currentBotId="${bot}" />` + content.slice(endAnchorIdx);
       } else {
           // The nav block is maybe still there completely!
           const startNav = content.indexOf('<nav className="flex items-center gap-1">');
           if (startNav !== -1) {
             const endNav = content.indexOf('</nav>', startNav);
             if (endNav !== -1) {
               content = content.slice(0, startNav) + `<BotSwitcher currentBotId="${bot}" />` + content.slice(endNav + 6);
             }
           }
       }
    }
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Processed ${bot}`);
  }
});
