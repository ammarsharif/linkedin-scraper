import os
import re

def fix_file(filepath, prefix):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Define variables to replace
    if prefix == "felix_":
        vars_to_replace = [
            'cronInterval', 'cronRunning', 'lastCronRun', 'cronLog',
            'processedMessageIds', 'consecutiveErrors', 'systemPrompt',
            'storedCUser', 'storedXs', 'storedDatr'
        ]
    elif prefix == "instar_grow_":
        vars_to_replace = [
            'growInterval', 'growRunning', 'lastGrowRun', 'growLog',
            'consecutiveErrors', 'dailyCounts', 'lastCounterReset'
        ]
    else:
        vars_to_replace = [
            'cronInterval', 'cronRunning', 'lastCronRun', 'cronLog',
            'processedThreadIds', 'consecutiveErrors', 'autoAcceptRequests',
            'systemPrompt'
        ]

    # Remove the `let ...` declarations for these variables
    for var in vars_to_replace:
        content = re.sub(r'(?m)^let ' + var + r'\b.*?\n', '', content)
        content = re.sub(r'(?m)^let ' + var + r'\b', '', content)

    # Use re.sub to replace word boundaries in usages of the local variables
    for var in vars_to_replace:
        content = re.sub(r'(?<!\.)\b' + var + r'\b', f'g.{prefix}{var}', content)

    # remove the g = globalThis definition that's already in the file
    content = re.sub(r'(?m)^const g = globalThis.*?\n', '', content)

    # Special: we need to ensure `g` is defined before we use it. 
    init_block = f"""
const g = globalThis as any;
if (g.{prefix}initialized === undefined) {{
    g.{prefix}initialized = true;
"""
    if prefix == "felix_":
        init_block += f"""
    g.{prefix}cronInterval = null;
    g.{prefix}cronRunning = false;
    g.{prefix}lastCronRun = null;
    g.{prefix}cronLog = [];
    g.{prefix}processedMessageIds = new Set();
    g.{prefix}consecutiveErrors = 0;
    g.{prefix}systemPrompt = "You are a professional Facebook Messenger assistant. Reply briefly, warmly and professionally to Facebook messages on behalf of the user. Keep replies under 3 sentences. Do not use emojis.";
    g.{prefix}storedCUser = null;
    g.{prefix}storedXs = null;
    g.{prefix}storedDatr = null;
"""
    elif prefix == "instar_grow_":
        init_block += f"""
    g.{prefix}growInterval = null;
    g.{prefix}growRunning = false;
    g.{prefix}lastGrowRun = null;
    g.{prefix}growLog = [];
    g.{prefix}consecutiveErrors = 0;
    g.{prefix}dailyCounts = {{ follow: 0, like: 0, comment: 0 }};
    g.{prefix}lastCounterReset = new Date().toDateString();
"""
    else:
        init_block += f"""
    g.{prefix}cronInterval = null;
    g.{prefix}cronRunning = false;
    g.{prefix}lastCronRun = null;
    g.{prefix}cronLog = [];
    g.{prefix}processedThreadIds = new Set();
    g.{prefix}consecutiveErrors = 0;
    g.{prefix}autoAcceptRequests = true;
    g.{prefix}systemPrompt = "You are a professional Instagram assistant. Reply briefly, warmly and professionally to Instagram Direct Messages on behalf of the user. Keep replies under 3 sentences. Be friendly and authentic.";
"""
    init_block += "}\n\n"

    # Insert init block after maxDuration
    content = re.sub(r'(export const maxDuration = \d+;)', r'\1\n' + init_block, content)

    if prefix == "instar_grow_":
        content = re.sub(r'(?m)^.*lastCounterReset.*\n', '', content)
        content = re.sub(r'(?m)^.*await syncDailyCountersFromDb\(\);\n', '', content)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

base_dir = r"d:\Devs Colab\linkedin_scraper\web\src\app\api"
fix_file(os.path.join(base_dir, r"instar\inbox\cron\route.ts"), "instar_inbox_")
fix_file(os.path.join(base_dir, r"instar\grow\cron\route.ts"), "instar_grow_")
fix_file(os.path.join(base_dir, r"felix\inbox\cron\route.ts"), "felix_")
print("Done!")
