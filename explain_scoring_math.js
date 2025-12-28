const CATEGORY_WEIGHTS = {
    politics: 1.5,    // Влияет сильно
    breaking: 1.5,
    crypto: 1.4,
    business: 1.3,
    world: 1.0,
    tech: 1.0,
    science: 0.8,
    sports: 0.6,      // Влияет слабо
    esports: 0.5
};

function calculateMath(scenarioName, articles) {
    console.log(`\n===============================================================`);
    console.log(`🧪 СЦЕНАРИЙ: ${scenarioName}`);
    console.log(`===============================================================`);

    if (!articles || articles.length === 0) return 50;

    let weightedSum = 0;
    let totalWeight = 0;
    const allScores = [];

    console.log(`\n1️⃣ ШАГ 1: Взвешивание каждой новости`);
    console.log(`-----------------------------------`);

    articles.forEach((article, i) => {
        const score = article.score;
        allScores.push(score);
        const category = (article.category || 'world').toLowerCase();

        // 1. Базовый вес
        let baseWeight = CATEGORY_WEIGHTS[category] || 1.0;
        let weight = baseWeight;

        // 2. Проверка на экстрим (<=15 или >=85)
        const isExtreme = score <= 15 || score >= 85;
        let note = "";

        if (isExtreme) {
            weight *= 2; // Удваиваем вес
            note = "⚡ ЭКСТРИМ (x2)";
        }

        weightedSum += score * weight;
        totalWeight += weight;

        console.log(`   📰 Новость #${i + 1}: "${article.title}"`);
        console.log(`      Оценка ИИ: ${score}`);
        console.log(`      Категория: ${category} (вес x${baseWeight})`);
        if (note) console.log(`      Модификатор: ${note}`);
        console.log(`      ИТОГ ВЕСА: ${weight.toFixed(2)}`);
        console.log(`      Вклад в сумму: ${score} * ${weight.toFixed(2)} = ${(score * weight).toFixed(2)}\n`);
    });

    const weightedAvg = totalWeight > 0 ? weightedSum / totalWeight : 50;

    console.log(`2️⃣ ШАГ 2: Среднее Взвешенное`);
    console.log(`   Сумма всех вкладов / Сумма всех весов`);
    console.log(`   ${weightedSum.toFixed(2)} / ${totalWeight.toFixed(2)} = ${weightedAvg.toFixed(2)}`);

    // 3. Финальная формула (70% Top Score + 30% Avg)
    const topScore = Math.max(...allScores);

    // Определяем Top Score (наиболее скандальную или позитивную)
    // Важно: в server.js используется просто Math.max(...allScores), что ищет МАКСИМУМ (ближе к 100/BURN).
    // Но если новости хорошие (MINT, score < 50), то "Top Score" по логике скандалов должен быть "самый экстремальный".
    // В текущем коде server.js (строка 355) берется Math.max.
    // Если все новости по 10 баллов (супер позитив), Math.max будет 10.
    // Если новости 90 баллов (супер негатив), Math.max будет 90.
    // Логика работает верно для BURN.

    console.log(`\n3️⃣ ШАГ 3: Финальная Формула (Правило 70/30)`);
    console.log(`   Мы берем самую "сильную" новость (MAX) и даем ей 70% влияния.`);
    console.log(`   Остальные новости (среднее) влияют только на 30%.`);
    console.log(`   Это нужно, чтобы один громкий скандал не "размазался" кучей мелких новостей.`);

    console.log(`   Максимальный балл (Max): ${topScore}`);
    console.log(`   Среднее (Avg): ${weightedAvg.toFixed(2)}`);

    const finalScore = (topScore * 0.7) + (weightedAvg * 0.3);

    console.log(`   ФОРМУЛА: (${topScore} × 0.7) + (${weightedAvg.toFixed(2)} × 0.3)`);
    console.log(`   РЕЗУЛЬТАТ: ${finalScore.toFixed(2)}`);

    console.log(`\n4️⃣ ШАГ 4: Определение Действия (MINT/BURN)`);

    let action = "UNKNOWN";
    let color = "";

    if (finalScore < 36) {
        action = "MINT (🟢 Позитив)";
        color = "🟢";
    } else if (finalScore > 64) {
        action = "BURN (🔴 Скандал)";
        color = "🔴";
    } else {
        action = "HOLD (⚪ Нейтраль)";
        color = "⚪";
    }

    console.log(`   Итоговый балл: ${finalScore.toFixed(2)}`);
    console.log(`   Решение: ${color} ${action}`);
}

// === ЗАПУСК СИМУЛЯЦИИ ===

// Сценарий 1: Одна бомбическая новость против кучи мусора
calculateMath("Один Скандал vs Скукота", [
    { title: "Президент украл бюджет (СКАНДАЛ)", category: "politics", score: 95 }, // Вес 1.5 * 2 = 3.0
    { title: "Котики родились", category: "world", score: 50 },
    { title: "Погода хорошая", category: "world", score: 50 },
    { title: "Новый рецепт пирога", category: "world", score: 50 }
]);

// Сценарий 2: Куча мелкого позитива (MINT)
calculateMath("Эйфория рынка (MINT)", [
    { title: "Биткоин пробил 100к", category: "crypto", score: 10 }, // Вес 1.4 * 2 = 2.8
    { title: "Ставки ФРС снижены", category: "business", score: 20 },
    { title: "Новый iPhone вышел", category: "tech", score: 30 }
]);

// Сценарий 3: Спорт (низкий вес) не должен ломать картину
calculateMath("Спорт против Политики", [
    { title: "Война началась (СКАНДАЛ)", category: "breaking", score: 90 }, // Вес 1.5 * 2 = 3.0
    { title: "Наша команда выиграла матч", category: "sports", score: 10 }, // Вес 0.6 * 2 = 1.2
    // Даже если спорт супер-позитивный (10 баллов), его вес (1.2) меньше веса скандала (3.0)
]);
