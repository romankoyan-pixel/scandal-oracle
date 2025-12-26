require('dotenv').config();
const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// The EXACT new system prompt from server.js
const systemPrompt = `You are "Scandal Oracle", an AI specialized in detecting financial corruption, crypto rugs, and global crises. Analyze the news.

# SCORING RUBRIC (0-10)
- Market Impact: 10 = Global crash, SEC ban. 0 = Low impact.
- Controversy: 10 = Fraud, Jail, Hack, War crimes. 0 = Routine.
- Viral Potential: 10 = "Breaking News", shocking. 0 = Boring.

# TASK
Return ONLY a JSON object: { "impact": number, "controversy": number, "viral": number, "reason": "short explanation 5 words" }`;

async function testScoring(title, description) {
    console.log(`\n📰 ANALYZING: "${title}"`);
    console.log(`   Context: ${description}`);

    try {
        const userPrompt = `News: "${title}" - ${description}`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 100
        });

        const result = JSON.parse(completion.choices[0].message.content);

        // Calculate Score
        const rawScore = ((result.impact || 0) + (result.controversy || 0) + (result.viral || 0)) / 3 * 10;
        const score = Math.min(100, Math.max(0, Math.round(rawScore)));

        console.log(`   👉 RAW JSON:`, JSON.stringify(result));
        console.log(`   🧠 CALCULATION: (${result.impact} + ${result.controversy} + ${result.viral}) / 3 * 10 = ${rawScore.toFixed(1)}`);
        console.log(`   🔥 FINAL SCORE: ${score} / 100`);
        console.log(`   🤖 REASON: "${result.reason}"`);

    } catch (e) {
        console.error("Error:", e.message);
    }
    console.log("-".repeat(50));
}

async function run() {
    console.log("🚀 STARTING LIVE ORACLE TEST (connecting to OpenAI...)\n");

    // Test 1: MAJOR SCANDAL
    await testScoring(
        "Binance CEO CZ Resigns, Pleads Guilty to Money Laundering",
        "The world's largest crypto exchange faces $4B fine. DOJ announces massive crackdown."
    );

    // Test 2: BORING NEWS
    await testScoring(
        "Bitcoin stays stable at $42,000 amid quiet weekend",
        "Trading volume is low as markets wait for next week's inflation data."
    );

    // Test 3: GOOD NEWS (Should be low scandal score)
    await testScoring(
        "BlackRock Bitcoin ETF Approved by SEC",
        "Historic moment for crypto as institutional money gets green light. Market rallies."
    );
}

run();
