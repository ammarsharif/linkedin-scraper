const fs = require('fs');
const path = require('path');

const filesToUpdate = ['demarko', 'inti', 'scraper'];

filesToUpdate.forEach(bot => {
  const filePath = path.join(__dirname, 'app', bot, 'page.tsx');
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Add import if not exists
    if (!content.includes('import { BotSwitcher } from "@/components/BotSwitcher";')) {
      const parts = content.split('import { useRouter } from "next/navigation";');
      if (parts.length === 2) {
        content = parts[0] + 'import { useRouter } from "next/navigation";\nimport { BotSwitcher } from "@/components/BotSwitcher";' + parts[1];
      }
    }
    
    // Try to find nav
    const startNav = content.indexOf('<nav className="flex items-center gap-1">');
    if (startNav !== -1) {
      const endNav = content.indexOf('</nav>', startNav);
      if (endNav !== -1) {
        content = content.slice(0, startNav) + `<BotSwitcher currentBotId="${bot}" />` + content.slice(endNav + 6);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated navigation for ${bot}`);
        return;
      }
    }

    // Try alternate nav start if any
    const altStartNav = content.indexOf('<!-- Navigation -->'); // Just in case
    console.log(`${bot} did not match <nav> block directly, startNav=${startNav}`);
  }
});
