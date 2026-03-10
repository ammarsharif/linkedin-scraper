const fs = require('fs');
const path = require('path');

const appDir = path.join(__dirname, 'app');
const bots = ['scraper', 'demarko', 'inti', 'cindy', 'sienna', 'cara'];

bots.forEach(bot => {
  const pagePath = path.join(appDir, bot, 'page.tsx');
  if (fs.existsSync(pagePath)) {
    let content = fs.readFileSync(pagePath, 'utf8');
    
    // Remove the bad import
    const badImport = 'import { BotSwitcher } from "@/components/BotSwitcher";\n';
    content = content.replace(badImport, '');
    
    // Add it after "lucide-react";
    const lucideImportMatch = content.match(/from "lucide-react";\n/);
    if (lucideImportMatch) {
      const index = lucideImportMatch.index + lucideImportMatch[0].length;
      content = content.slice(0, index) + '\nimport { BotSwitcher } from "@/components/BotSwitcher";\n' + content.slice(index);
      fs.writeFileSync(pagePath, content, 'utf8');
      console.log(`Fixed ${bot}/page.tsx`);
    } else {
      console.log(`lucide-react import not found in ${bot}/page.tsx`);
      // Try to just add it at the top after "use client";
      const useClientMatch = content.match(/"use client";\n/);
      if (useClientMatch) {
        const index = useClientMatch.index + useClientMatch[0].length;
        content = content.slice(0, index) + '\nimport { BotSwitcher } from "@/components/BotSwitcher";\n' + content.slice(index);
        fs.writeFileSync(pagePath, content, 'utf8');
        console.log(`Fixed ${bot}/page.tsx (fallback)`);
      }
    }
  }
});
