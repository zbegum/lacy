function buildCodebaseTourPrompt({
  tour_focus,
  projectKnowledge,
  target_audience,
  fileSummaryList,
  fileContents,
  language = "en",
  description = ""
}) {
  const audienceGuide = {
    low: {
      en: "Assume the audience has no prior knowledge of the project or codebase. Be beginner-friendly.",
      tr: "Hedef kitlenin proje veya kod tabanı hakkında ön bilgisi olmadığını varsayın. Başlangıç seviyesine uygun anlatın.",
    },
    mid: {
      en: "Assume the audience understands the project goals and general architecture. Avoid oversimplifying.",
      tr: "Hedef kitlenin proje hedeflerini ve genel mimariyi anladığını varsayın. Aşırı basitleştirmeyin.",
    },
    high: {
      en: "Assume the audience is very familiar with the project. Focus on deep technical logic and nuances.",
      tr: "Hedef kitlenin projeye çok hakim olduğunu varsayın. Derin teknik mantığa ve nüanslara odaklanın.",
    },
  };

  // The sidebar sends "medium"; the guide uses "mid".
  const guide = audienceGuide[projectKnowledge === "medium" ? "mid" : projectKnowledge] || audienceGuide.low;

  let transcriptSection;
  if (language === "tr") {
    transcriptSection = description
      ? `
### Uzmanın açıklaması (ses transkripti olabilir)

Uzman kod tabanını incelerken aşağıdaki açıklamayı kaydetti veya yazdı. Bu transkripti turda vurgu yapılacak konular için **birincil rehber** olarak kabul edin. Transkriptte belirtilen konuları, ilgili kod parçalarını önceliklendirin.

"""
${description}
"""
`
      : `
### Uzmanın açıklaması (ses transkripti olabilir)

Bu tur için bir transkript sağlanmadı. Yalnızca dosyalara ve tur odağına güvenin.
`;
  } else {
    transcriptSection = description
      ? `
### Expert's description (can be audio transcript)

The expert recorded or wrote the following description while walking through the codebase.
Treat this transcript as the **primary guidance** for what to emphasize in the tour.
Prioritize code that directly supports, implements, or illustrates the topics mentioned here.

"""
${description}
"""
`
      : `
### Expert's description (can be audio transcript)

No transcript was provided for this tour. Rely only on the files and tour focus.
`;
  }

  if (language === "tr") {
    return `
      Kıdemli bir geliştirici asistanısın ve kod tabanları için yapılandırılmış öğrenme turları üretiyorsun.

      ### Amaç
      Bir kod tabanı turu için adım listesini JSON dizisi olarak üret.

      Her adım **yalnızca bir kod satırı aralığını** anlatmalı ve yüksek kaliteli açıklama içermelidir. Satır numaralarını ve dosya yollarını doğru kullan.

      ---

      ### Tur Girdileri:
      - **Tur Odağı**: ${tour_focus}
      - **Hedef Kitlenin Bilgi Seviyesi**: ${projectKnowledge}
      - **Hedef Kitle**: ${target_audience}
      - **İstenen Uygulama Detayı**: Evet
      - Birden fazla dosya var. Adımları dosyalara adil şekilde dağıt.
      ### Hatırlatma:
      Aşağıdaki dosyaların **her biri** en az bir adımda yer almalı:
        ${fileSummaryList}

      ${transcriptSection}

      ---

      ### Anlatım Stili:
      ${guide.tr}

      Hem uygulama seviyesinde teknik içgörü hem de anlaşılır açıklamalar ekle. Spesifik ve geliştirici odaklı ol. Basit ve bariz açıklamalardan kaçın.

      ---

      ### ZORUNLU ÇIKTI FORMATı
      Sadece **geçerli bir JSON dizisi** döndür. Her nesne tam olarak şu formatta olmalı:

      {
        "step_number": <number>,
        "description": "markdown metin (2–8 cümle) seçilen kodun ne yaptığını ve neden önemli olduğunu açıklar. HTML yok. Satır sonları için \\n kullan."
        "file_path": "<relative/path/to/file>",
        "line_start": <start_line>,
        "line_end": <end_line>,
        "created_at": "<ISO timestamp like 2024-01-01T00:00:00Z>"
      }

      ---

      ### Kurallar:
      1. line_start ve line_end değerlerini dosya girdilerindeki satırlarla birebir eşleştir.
      2. Her dosya (veya dosya parçası) **en az bir adımda** kullanılmalıdır.
      3. Açıklamalar **Tur Odağı**, **Bilgi Seviyesi** ve gerekiyorsa **Uygulama Detayı** ile uyumlu olmalıdır.
      4. Girdide gösterilmeyen tam dosya içeriklerini ekleme.
      5. Sadece **saf JSON** döndür.
      6. 5–20 satırlık küçük mantıksal bloklar seç. 30 satırı **aşma** (kesinlikle gerekmedikçe).
      7. Alakasız bölümleri birleştirme; 30 satırı aşan blokları böl.
      8. Dosya büyükse, en fazla 50 satırlık daha küçük adımlara böl.
      9. Seçilen bölüm 30 satırı aşıyorsa, detayları takip eden adımlarda açıkla.
      10. Dosyaları sıraya göre değil eşit önemle ele al.
      11. Tüm dosyayı veya çok büyük çoklu fonksiyon bloklarını seçme.
      12. Dosya tamamen boş değilse atlama.
      13. İlk dosyalara aşırı odaklanma; her dosya **en az bir adım** almalı.
      14. Dosya bölümü 50 satırı aşıyorsa önce olduğu gibi ekle, sonra daha küçük seçimlerle detaylandır.
      15. İlk dosyanın daha önemli olduğunu varsayma.
      17. Planlamaya her dosya için 1 adım vererek başla, sonra gerekiyorsa ekle.
      18. Uzun açıklamalar yerine küçük ve net adımları tercih et.
      19. Aynı dosyaya ait adımlar ardışık olmalı ve dosyada yukarıdan aşağıya ilerlemelidir.
      20. 50 satıra yaklaşmak yerine daha küçük adımlara böl.
      ---

      ### Kod Bağlamı:
      Her dosya "START OF FILE" ve "END OF FILE" arasında ayrılmıştır.
      Kısmi dosyalar "Part from line X to Y" markerlarıyla ayrılır.
      Dosya yolu ve satır numaralarını doğru kullan.
      
      ${fileContents}
    `;
  }

  return `
      You are a senior developer assistant that generates structured learning tours of codebases.

      ### Objective
      Generate a JSON array of steps for a codebase tour.

      Each step **must describe exactly one range of code lines** from a provided file and include a high-quality explanation. Use line numbers and file paths precisely.

      ---

      ### Tour Inputs:
      - **Tour Focus**: ${tour_focus}
      - **Audience Knowledge Level**: ${projectKnowledge}
      - **Target Audience**: ${target_audience}
      - **Implementation Details Requested**: Yes
      - Multiple files provided. Ensure fair distribution of steps across all files.
      ### Reminder:
      The following files must **each** appear in at least one step:
        ${fileSummaryList}
        ${transcriptSection}

      ---

      ### Instruction Style:
      ${guide.en}

      Include both implementation-level technical insights and accessible explanations. Be spesific and developer focused. Avoid trivial or obvious explanations.

      ---

      ### MUST-FOLLOW Output Format
      Return only a **valid JSON array**, where each object is exactly in this format:

      {
        "step_number": <number>,
        "description": "markdown text (2–8 sentences) explaining what the selected code does and why. No HTML. Use \\n for line breaks."
        "file_path": "<relative/path/to/file>",
        "line_start": <start_line>,
        "line_end": <end_line>,
        "created_at": "<ISO timestamp like 2024-01-01T00:00:00Z>"
      }

      ---

      ### Rules:
      1. Match line_start and line_end values exactly to the lines shown in the file inputs.
      2. Every file (or file part) **must** be used in at least one step.
      3. Descriptions must reflect the **Tour Focus**, **Audience Level**, and optionally **Implementation Detail**.
      4. **Heavily ground the tour in the transcript** when it is provided:
         - Identify the main topics, flows, or concerns mentioned in the transcript.
         - Prefer code regions that directly implement or illustrate these points.
         - If the transcript mentions specific functionality, bugs, or flows, prioritize those files and nearby lines.
      5. DO NOT include full file contents unless shown in the input.
      6. Only return **pure JSON**.
      7. Select small logical blocks of 5–20 lines only. DO NOT EXCEED 30 lines unless ABSOLUTELY necessary. You will be penalized for exceeding this limit.
      8. Never merge unrelated sections or large blocks over 30 lines. Split them into multiple steps.
      9. If a file is large, split it into multiple logical smaller steps, each no longer than 50 lines.
      10. If any part you have selected is longer than 30 lines, explain its details in following steps.
      11. Treat all files equally regardless of order. Distribute attention across them.
      12. Do NOT select entire files or large multi-function ranges.
      13. Do not skip any files unless they are completely empty.
      14. Absolutely avoid focusing only on early files. Every file must receive **at least one step**, preferably more if there multiple features.
      15. If the file detail section is longer than 50 lines. First include it as is, and then explain it further in following steps in smaller selections.
      16. Do not assume the first file is more important — it is not. You will be penalized for over-representing the top file.
      17. Start your planning by assigning 1 step per file. Then add more if needed, but never skip any.
      18. You will be awarded for detailed descriptions, but not for long ones. Try to separate them into smaller steps. Diving a lond description into smaller steps is better than including it as is.
      19. Always make sure steps related to one file are come one after the other and start from the one thats higher up in the file.
      20. Rather than choosing close to 50 lines, separate that 50 lines into smaller steps.
      ---

      ### Code Context:
      Each file is clearly separated by "START OF FILE" and "END OF FILE" markers.
      Partial files are separated by "Part from line X to Y" markers.
      Always reference the correct file_path and line numbers exactly as shown.
      
      ${fileContents}
    `;
}

function buildTourNamePrompt({
  tour_focus,
  projectKnowledge,
  projectName,
  fileList,
  randomizer,
  language = "en",
}) {
  if (language === "tr") {
    return `
      Kod tabanları için kendinden rehberli turlar düzenlemeye yardımcı olan bir geliştirici asistanısın.
  
      Aşağıdaki bağlama göre bu tur için **kısa, etkileyici ve en önemlisi benzersiz** bir isim üret. Gerçekten benzersiz olmalı, rastgele bir isim olmasın.
  
      Gereksinimler:
      - İsim yaratıcı ve bağlama uygun olsun.
      - Mümkünse dosya adlarından ilham al.
      - 5 kelimeyi aşma.
      - "My Tour" veya "Project Tour" gibi *genel* başlıklardan kaçın.
  
      ---
      Tur Odağı: ${tour_focus}
      Hedef Kitle Bilgi Seviyesi: ${projectKnowledge}
      Teknik Detay Dahil: Evet
      Proje Adı: ${projectName}
      Turdaki Dosyalar: ${fileList}
      RASTGELE SEED: ${randomizer}
      ---
      Sadece tur ismini döndür, açıklama ekleme.
    `;
  }

  return `
      You are a developer assistant helping organize self-guided tours of codebases.
  
      Based on the following context, generate a **concise, engaging and most importantly unique name** for this tour. And I mean really unique, not just a random name. 
  
      Requirements:
      - Make the name creative and relevant.
      - Use inspiration from the file names if possible.
      - Do NOT use more than 5 words.
      - *Avoid generic titles* like "My Tour" or "Project Tour".
  
      ---
      Tour Focus: ${tour_focus}
      Audience Knowledge: ${projectKnowledge}
      Technical Details Included: Yes
      Project Name: ${projectName}
      Files in Tour: ${fileList}
      RANDOMIZER SEED: ${randomizer}
      ---
      Respond with only the tour name, no explanations.
    `;
}

function buildQuizQuestionsPrompt({
  numQuestions,
  tour_focus,
  projectKnowledge,
  targetDepartment,
  fileContents,
  language = "en",
}) {
  if (language === "tr") {
    return `
            Kod tabanı turları için quiz soruları üreten kıdemli bir geliştirici asistanısın.

            ### Amaç
            Sağlanan kod tabanına göre tam olarak ${numQuestions} soru üret.

            Her soru şunları içermelidir:
            - Soru açıklaması
            - Soru tipi (radio veya checkbox)
            - Seçenekler **JSON string dizisi** olarak (yalnızca değerler)
            - Doğru cevaplar **JSON string dizisi** olarak
            - Puan

            ---

            ### Tur Girdileri:
            - **Tur Odağı**: ${tour_focus}
            - **Hedef Kitlenin Bilgi Seviyesi**: ${projectKnowledge}
            - **Hedef Kitle**: ${targetDepartment}
            - **İstenen Uygulama Detayı**: Evet

            ---

            ### Kod Bağlamı:
            ${fileContents}

            ---

            ### ZORUNLU ÇIKTI FORMATı
            Sadece **geçerli bir JSON dizisi** döndür. Her nesne tam olarak şu formatta olmalı:

            {
                "question_id": <number>,
                "question": "<soru açıklaması>",
                "question_type": "<radio | checkbox>", 
                "options": ["<secenek1>", "<secenek2>", "<secenek3>", ...], // Yalnızca değerler, label veya tag yok
                "answers": ["<dogru_cevap1>", "<dogru_cevap2>", ...],
                "score": <number>
            }

            ---

            ### Kurallar:
            1. "options" alanı yalnızca değerlerden oluşan JSON string dizisi olmalıdır.
            2. Seçeneklerde "label" veya "value" gibi ek alanlar ekleme.
            3. JSON geçerli olmalı ve formatı tam takip etmeli.
            4. JSON dizisi dışında ek metin veya açıklama döndürme.
            5. **UYARI:** JSON dizisi dışında herhangi bir metin/formatlama eklersen çıktı reddedilir. Sadece JSON dizisi döndür.
        `;
  }

  return `
            You are a senior developer assistant that generates quiz questions for codebase tours.

            ### Objective
            Generate exactly ${numQuestions} quiz questions based on the provided codebase.

            Each question must include:
            - A question description
            - A question type (radio or checkbox)
            - Options as a **JSON array of strings** (only the values, no labels or tags)
            - Correct answers as a **JSON array of strings**
            - A score

            ---

            ### Tour Inputs:
            - **Tour Focus**: ${tour_focus}
            - **Audience Knowledge Level**: ${projectKnowledge}
            - **Target Audience**: ${targetDepartment}
            - **Implementation Details Requested**: Yes

            ---

            ### Code Context:
            ${fileContents}

            ---

            ### MUST-FOLLOW Output Format
            Return only a **valid JSON array**, where each object is exactly in this format:

            {
                "question_id": <number>,
                "question": "<question description>",
                "question_type": "<radio | checkbox>", 
                "options": ["<option1>", "<option2>", "<option3>", ...], // Only values, no labels or tags
                "answers": ["<correct_answer1>", "<correct_answer2>", ...],
                "score": <number>
            }

            ---

            ### Rules:
            1. The "options" field must be a JSON array of strings, containing only the values for the options.
            2. Do not include any additional tags like "label" or "value" in the options.
            3. Ensure the JSON is valid and follows the specified format strictly.
            4. Return only the JSON array, with no additional text or explanations.
            5. **WARNING:** If you include any text, explanation, or formatting outside the JSON array, your output will be rejected and penalized. Only output the JSON array, nothing else.
        `;
}

function buildPodcastScriptPrompt({ fileContents }) {
  return `
    Simulate a structured podcast style conversation between an expert developer and a junior developer who just joined the project.
    The expert is walking the junior through the following code files, their relations and their key functions:

    Files:
    - ${fileContents}

    Objective:
    Create an in-depth, layered explanation that thoroughly covers:
    - What each file and function does
    - How they interact and contribute to the overall architecture
    - Important implementation decisions and why they were made
    - Real-world analogies or metaphors to aid understanding
    - Pitfalls, edge cases, and developer insights from experience

    Tone & Style:
    - The expert should lead with long, coherent teaching blocks
    - The junior should listen, occasionally ask thoughtful questions, or reflect on what they understood
    - Avoid frequent interruptions — aim for a mentor-style 1:1 session
    - Keep the tone conversational but highly informative
    - Conclude with a summary of key takeaways
    - Use a mix of technical jargon and layman's terms to ensure clarity
    - Use a friendly, approachable tone

    Output Requirements:
    - Format the output like a dialogue:
    Expert: ...
    Junior: ...
    - Total output: 100-200 words (for a 2-3 minute walkthrough)
    - Avoid filler — focus on real code structure, reasoning, and learning value
  `.trim();
}

module.exports = {
  buildCodebaseTourPrompt,
  buildTourNamePrompt,
  buildQuizQuestionsPrompt,
  buildPodcastScriptPrompt,
};