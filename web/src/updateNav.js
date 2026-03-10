const fs = require('fs');
const path = require('path');

const appDir = path.join(__dirname, 'app');
const bots = ['scraper', 'ceevee', 'demarko', 'inti', 'cindy', 'sienna', 'cara'];

bots.forEach(bot => {
  const pagePath = path.join(appDir, bot, 'page.tsx');
  if (fs.existsSync(pagePath)) {
    let content = fs.readFileSync(pagePath, 'utf8');
    
    // Add import if not exists
    if (!content.includes('BotSwitcher')) {
       // Find last import statement
       const lastImportIndex = content.lastIndexOf('import ');
       const endOfLastImport = content.indexOf('\n', lastImportIndex);
       content = content.slice(0, endOfLastImport + 1) + 
                 'import { BotSwitcher } from "@/components/BotSwitcher";\n' + 
                 content.slice(endOfLastImport + 1);
    }

    // Replace <nav>...</nav> with <BotSwitcher currentBotId="bot" />
    // The <nav> tag might span multiple lines
    const navStart = content.indexOf('<nav className="flex items-center gap-1">');
    if (navStart !== -1) {
      const navEnd = content.indexOf('</nav>', navStart) + 6;
      content = content.slice(0, navStart) + `<BotSwitcher currentBotId="${bot}" />` + content.slice(navEnd);
      fs.writeFileSync(pagePath, content, 'utf8');
      console.log(`Updated ${bot}/page.tsx`);
    } else {
      console.log(`Could not find <nav> in ${bot}/page.tsx`);
    }
  }
});
